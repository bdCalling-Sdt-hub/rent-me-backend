import { getDuration, validateOrderTime } from './order.utils';

import { StatusCodes } from 'http-status-codes';
import ApiError from '../../../errors/ApiError';

import {
  IEnrichedOrder,
  IOrder,
  IOrderFilterableFields,
} from './order.interface';
import { Order } from './order.model';
import { calculateDistance, generateCustomOrderId } from './order.utils';
import { JwtPayload } from 'jsonwebtoken';
import { USER_ROLES } from '../../../enums/user';
import {
  sendDataWithSocket,
  sendNotification,
} from '../../../helpers/sendNotificationHelper';
import { User } from '../user/user.model';
import { Types } from 'mongoose';

import { IVendor } from '../vendor/vendor.interface';
import { ICustomer } from '../customer/customer.interface';
import config from '../../../config';
import { paginationHelper } from '../../../helpers/paginationHelper';
import { IPaginationOptions } from '../../../types/pagination';
import { orderSearchableFields } from './order.constant';
import { Vendor } from '../vendor/vendor.model';
import { Package } from '../package/package.model';
import { Cart } from '../cart/cart.model';


const createOrder = async (payload: IOrder) => {
  const orderId = await generateCustomOrderId();
  payload.orderId = orderId;

  const {
    deliveryDateAndTime,
    vendorId,
    customerId,
    isSetup,
    setupDuration,
    isCustomOrder,
  } = payload;

  // Fetch vendor, customer, and package details
  const [vendorExist, customerExist, packageExist] = await Promise.all([
    User.findOne({ vendor: vendorId, status: 'active' }).populate<{vendor:IVendor}>({
      path: 'vendor',
      select: {
        name: 1,
        operationStartTime: 1,
        operationEndTime: 1,
        availableDays: 1,
        location: 1,
        deviceId:1
      }
    }),
    User.findOne({ customer: customerId, status: 'active' }).populate(
      'customer',
      {
        name: 1,
      }
    ),
    !isCustomOrder
      ? Package.findById(payload.packageId, { setupFee: 1, setupDuration: 1 })
      : Promise.resolve(null), // Skip querying the package if isCustomOrder is true
  ]);

  // Validate vendor, customer, and package existence
  if (!vendorExist) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Vendor does not exist');
  }
  if (!customerExist) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Customer does not exist');
  }
  if (!packageExist && !isCustomOrder) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Package does not exist');
  }

  // Validate delivery date and time
  const { operationStartTime, operationEndTime, availableDays, location } =
    vendorExist.vendor as IVendor;

  const requestedDay = new Date(deliveryDateAndTime).toLocaleDateString(
    'en-US',
    {
      weekday: 'long',
    }
  );

  const deliveryDate = new Date(deliveryDateAndTime);
  const currentDate = new Date();
  const offsetMs = currentDate.getTimezoneOffset() * 60 * 1000;
  const currentLocalDate = new Date(currentDate.getTime() - offsetMs);

  if (deliveryDate.getTime() < currentLocalDate.getTime()) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Order cannot be created in the past.'
    );
  }

  if (!availableDays!.includes(requestedDay)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Vendor is not available on the requested day.'
    );
  }

  // Calculate delivery fee and product price for custom orders
  if (isCustomOrder) {
    validateOrderTime(
      deliveryDateAndTime,
      operationStartTime!,
      operationEndTime!
    );

    const fee = payload.deliveryFee
      ? Number(payload.deliveryFee)
      : Number(
          calculateDistance(
            [location.coordinates[0], location.coordinates[1]],
            [
              payload.deliveryLocation.coordinates[0],
              payload.deliveryLocation.coordinates[1],
            ]
          ) * Number(config.delivery_fee)
        ).toFixed(2);

    payload.deliveryFee = Number(fee);



  }

  // Validate setup duration and calculate setup start time
  if (isSetup) {
    const setupDurationMs = getDuration(setupDuration);
    if (
      isNaN(setupDurationMs) ||
      isNaN(new Date(deliveryDateAndTime).getTime())
    ) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        'Invalid setup duration or delivery date.'
      );
    }

    const setupStartDateAndTime = new Date(
      new Date(deliveryDateAndTime).getTime() - setupDurationMs
    );
    if (packageExist) {
      payload.setupFee = packageExist.setupFee;
    }
    payload.setupStartDateAndTime = setupStartDateAndTime;

    if (payload.setupStartDateAndTime.getTime() < currentLocalDate.getTime()) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `${payload.setupStartDateAndTime.toString()} conflict with current time.`
      );
    }
  }

  // Check for existing orders
  const query = isSetup
    ? [
        {
          setupStartDateAndTime: { $lt: deliveryDateAndTime },
          deliveryDateAndTime: { $gt: payload.setupStartDateAndTime },
        },
      ]
    : [
        {
          setupStartDateAndTime: { $lt: deliveryDateAndTime },
          deliveryDateAndTime: { $gt: deliveryDateAndTime },
        },
      ];

  const existingOrder = await Order.findOne({
    vendorId: payload.vendorId,
    status: { $in: ['accepted', 'ongoing', 'started'] },
    $and: query,
  });

  if (existingOrder) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'The vendor is already busy during this time slot.'
    );
  }

  const customerExistingOrder = await Order.findOne({
    customerId: payload.customerId,
    vendorId: payload.vendorId,
    status: { $in: ['pending', 'accepted', 'ongoing', 'started'] },
    $and: query,
  });

  if (customerExistingOrder) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'You have already placed an order with this vendor during this time slot.'
    );
  }

  // Create the order
  const result = await Order.create([payload]);
  if (result.length === 0) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Failed to create order.');
  }


  await Cart.findOneAndUpdate(
    { customerId: payload.customerId },
    { $pull: { items: { vendorId: payload.vendorId } } }
  );

  // Send notification and socket event
  await sendOrderNotificationAndSocketEvent(
    payload.vendorId as Types.ObjectId,
    customerExist.customer as ICustomer,
    payload.orderId,
    vendorExist.vendor.deviceId,
    result
  );

  return result;
};

// Helper function to send notification and socket event
const sendOrderNotificationAndSocketEvent = async (
  vendorId: Types.ObjectId,
  customer: ICustomer,
  orderId: string,
  deviceId: string,
  orderDetails: IOrder[]
) => {
  await sendDataWithSocket('newOrder', vendorId, {
    ...orderDetails,
  });



  const notificationTitle = `New order request from ${customer.name}`;
  const notificationMessage = `${customer.name} has placed an order. Please accept or reject the order. Order ID: ${orderId}`;

await sendNotification('getNotification', vendorId, {
  userId: vendorId,
  title: notificationTitle,
  message: notificationMessage,
  type: USER_ROLES.VENDOR,
},{
  deviceId: deviceId,
  destination: 'order',
  role: USER_ROLES.VENDOR,
  id: orderDetails[0]._id as unknown as string,
  icon: 'https://res.cloudinary.com/di2erk78w/image/upload/v1739447789/B694F238-61D7-490D-9F1B-3B88CD6DD094_1_1_kpjwlx.png'
})


};

const getAllOrders = async (
  filters: IOrderFilterableFields,
  paginationOptions: IPaginationOptions
) => {
  const { page, limit, skip, sortOrder, sortBy } =
    paginationHelper.calculatePagination(paginationOptions);

  const { searchTerm, ...filtersData } = filters;

  const andConditions = [];

  if (searchTerm) {
    andConditions.push({
      $or: orderSearchableFields.map(field => ({
        [field]: {
          $regex: searchTerm,
          $options: 'i',
        },
      })),
    });
  }

  if (Object.keys(filtersData).length) {
    andConditions.push({
      $and: Object.entries(filtersData).map(([field, value]) => ({
        [field]: value,
      })),
    });
  }

  const whereConditions =
    andConditions.length > 0 ? { $and: andConditions } : {};
  const result = await Order.find(whereConditions)
    .populate('vendorId', {
      name: 1,
      email: 1,
      profileImg: 1,
      phone: 1,
      businessContact: 1,
      businessTitle: 1,
      businessAddress: 1,
      businessContactCountryCode: 1,
    })
    .populate('customerId', {
      name: 1,
      email: 1,
      profileImg: 1,
      phone: 1,
      address: 1,
    })
    .skip(skip)
    .sort({ [sortBy]: sortOrder })
    .limit(limit);

  if (!result) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Failed to get orders');
  }

  const total = await Order.countDocuments(whereConditions);

  return {
    meta: {
      page,
      limit,
      total,
    },
    data: result,
  };
};

const getAllOrderByUserId = async (
  user: JwtPayload,
  filters: Partial<IOrderFilterableFields>,
  paginationOptions: IPaginationOptions
) => {
  const { serviceDate, ...filterData } = filters;
  const { page, limit, skip, sortOrder, sortBy } =
    paginationHelper.calculatePagination(paginationOptions);

  const andCondition = [];

  if (Object.keys(filterData).length > 0) {
    andCondition.push({
      $and: Object.entries(filterData).map(([field, value]) => {
        return {
          [field]: value,
        };
      }),
    });
  }

  if (serviceDate) {
    const startOfDay = new Date(`${serviceDate}T00:00:00.000Z`);
    const endOfDay = new Date(`${serviceDate}T23:59:59.999Z`);

    andCondition.push({
      $or: [
        {
          setupStartDateAndTime: { $gte: startOfDay, $lt: endOfDay },
        },
        {
          deliveryDateAndTime: { $gte: startOfDay, $lt: endOfDay },
        },
      ],
    });
  }

  const { role } = user;

  if (role === USER_ROLES.CUSTOMER) {
    andCondition.push({ customerId: user.userId });
  } else {
    andCondition.push({ vendorId: user.userId });
  }

  const whereConditions = andCondition.length > 0 ? { $and: andCondition } : {};

  const result = await Order.find(whereConditions)
    .populate('vendorId', {
      name: 1,
      email: 1,
      phone: 1,
      address: 1,
      profileImg: 1,
      orderCompleted: 1,
      rating: 1,
      totalReviews: 1,
      verifiedFlag: 1,
      businessContact: 1,
      businessContactCountryCode: 1,
      location: 1,
    })
    .populate('packageId', { title: 1 })
    .populate('serviceId', { title: 1, price: 1 })
    .populate('paymentId')
    .populate('customerId', {
      name: 1,
      email: 1,
      phone: 1,
      address: 1,
      profileImg: 1,
    })
    .populate({
      path: 'products',
      select: 'quantity',
      populate: {
        path: 'product',
        select: 'name dailyRate hourlyRate',
      },
    })
    .populate('review', { rating: 1, comment: 1 })
    .skip(skip)
    .sort({ [sortBy]: sortOrder })
    .limit(limit)
    .lean();

  if (!result) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Failed to get orders');
  }

  const total = await Order.countDocuments(whereConditions);

  const applicationChargeRate = Number(config.application_fee);
  const ccChargeRate = Number(config.customer_cc_rate);
  const instantTransferFeeRate = Number(config.instant_transfer_fee);

  const enrichedOrders = result.map(order => {
    const enrichedOrder: IEnrichedOrder & IOrder = {
      ...order,
    };

    // Calculate CC charge for customers
    if (user.role === USER_ROLES.CUSTOMER) {
      enrichedOrder.customerCCChargeRate = ccChargeRate;
      enrichedOrder.customerCCCharge = order?.amount
        ? order?.amount * ccChargeRate
        : order.offeredAmount! * ccChargeRate;
    }

    // Calculate vendor-specific fields
    if (user.role === USER_ROLES.VENDOR) {
      const applicationCharge = Math.floor(
        order?.amount
          ? order?.amount
          : order.offeredAmount! *
              (order.isInstantTransfer
                ? instantTransferFeeRate
                : applicationChargeRate)
      );
      const instantTransferFee = order.isInstantTransfer
        ? Math.floor(
            order?.amount
              ? order?.amount
              : order.offeredAmount! * instantTransferFeeRate
          )
        : 0;

      if (order.isInstantTransfer) {
        enrichedOrder.instantTransferChargeRate = instantTransferFeeRate;
        enrichedOrder.instantTransferCharge = instantTransferFee;
      }
      if (!order.isInstantTransfer) {
        enrichedOrder.applicationChargeRate = applicationChargeRate;
      }

      enrichedOrder.vendorReceivable = Math.floor(
        order?.amount
          ? order?.amount
          : order.offeredAmount! +
              (order.isSetup ? order?.setupFee : 0) +
              order.deliveryFee -
              (applicationCharge + instantTransferFee
                ? instantTransferFee
                : 0 - (enrichedOrder.customerCCCharge || 0))
      );
      enrichedOrder.applicationCharge = applicationCharge;
    }

    // Calculate subTotal including optional fields
    const setupFee = order.setupFee || 0;
    const deliveryCharge = order.deliveryFee || 0;
    enrichedOrder.subTotal = Math.floor(
      order.amount +
        setupFee +
        deliveryCharge +
        (enrichedOrder.customerCCCharge || 0)
    );

    return enrichedOrder;
  });

  return {
    meta: {
      page,
      limit,
      total,
    },
    data: enrichedOrders,
  };
};

const getSingleOrder = async (id: string) => {
  const result = await Order.findById(id)
    .populate('vendorId', {
      name: 1,
      email: 1,
      phone: 1,
      address: 1,
      profileImg: 1,
      orderCompleted: 1,
      rating: 1,
      totalReviews: 1,
      verifiedFlag: 1,
      businessContact: 1,
    })
    .populate('packageId', { title: 1 })
    .populate('serviceId', { title: 1, price: 1 })
    .populate('paymentId')
    .populate('customerId', {
      name: 1,
      email: 1,
      phone: 1,
      address: 1,
      profileImg: 1,
    })
    .populate('review', { rating: 1, comment: 1 })
    .lean();
  if (!result) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Order does not exist');
  }
  return result;
};

const declineOrder = async (
  id: string,
  payload: Pick<IOrder, 'status' | 'deliveryDeclineMessage'>
) => {
  if (payload?.status === 'declined' && !payload?.deliveryDeclineMessage) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Delivery Decline Message is required'
    );
  }

  const orderExists = await Order.findById({
    _id: id,
    status: 'accepted',
  })
    .populate('vendorId', { name: 1, deviceId:1 })
    .populate('customerId', { name: 1 , deviceId:1});
  if (!orderExists) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Order not found');
  }

  const [vendorExist, customerExist] = await Promise.all([
    User.findOne(
      { vendor: orderExists?.vendorId, status: 'active' },
      { status: 1 }
    ).populate<{vendor:{_id:1,name:string, deviceId:string}}>('vendor', { name: 1, deviceId:1 }),
    User.findOne({
      customer: orderExists?.customerId,
      status: 'active',
    }).populate('customer', { name: 1 }),
  ]);

  if (!vendorExist) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Vendor not found');
  }
  if (!customerExist) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Customer not found');
  }

  if (customerExist._id.toString() !== orderExists.customerId.toString()) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'You are not allowed to update status of  this order'
    );
  }

  //update the order status
  const result = await Order.findOneAndUpdate(
    { _id: id, status: 'accepted' },
    { $set: { ...payload } },
    { new: true }
  );

  if (!result) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Failed to update order');
  }

  const { name } = customerExist?.customer as ICustomer;



  await sendDataWithSocket(
    'declinedOrder',
    orderExists.vendorId as Types.ObjectId,
    {
      ...result,
    }
  );



  const notificationTitle = `${name} has ${payload?.status} the order. Order ID: ${result?.orderId}`;
  const notificationMessage = `${payload?.deliveryDeclineMessage}`;

  //TODO: send notification to vendor need testing
  await sendNotification('getNotification', vendorExist._id, {
    userId: vendorExist._id,
    title: notificationTitle,
    message: notificationMessage,
    type: USER_ROLES.VENDOR,
  },{
    deviceId: vendorExist.vendor.deviceId,
    destination: 'order',
    role: USER_ROLES.VENDOR,
    id: vendorExist.vendor._id as unknown as string,
    icon: 'https://res.cloudinary.com/di2erk78w/image/upload/v1739447789/B694F238-61D7-490D-9F1B-3B88CD6DD094_1_1_kpjwlx.png'
  })

  return result;
};

const rejectOrAcceptOrder = async (id: string, payload: Partial<IOrder>) => {
  if (payload.status === 'accepted' && !payload.amount) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Amount is required');
  }

  const orderExists = await Order.findById({ _id: id, status: 'pending' })
    .populate('vendorId', { name: 1 })
    .populate('customerId', { name: 1 });

  if (!orderExists) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Order not found');
  }

  const [vendorExist, customerExist] = await Promise.all([
    User.findOne(
      { vendor: orderExists?.vendorId, status: 'active' },
      { status: 1 }
    ).populate('vendor', {
      name: 1,
      stripeId: 1,
      stripeConnected: 1,
      verifiedFlag: 1,
    }),
    User.findOne({
      customer: orderExists?.customerId,
      status: 'active',
    }).populate<{customer:{_id:Types.ObjectId,name:string}}>('customer', { name: 1 }),
  ]);

  if (!vendorExist) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Vendor not found');
  }
  if (!customerExist) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Customer not found');
  }

  const {_id:vendorId, stripeId, stripeConnected, verifiedFlag, name, deviceId } =
    vendorExist.vendor as IVendor;

  if (
    !stripeId ||
    stripeId === '' ||
    stripeId === null ||
    stripeId === undefined ||
    !stripeConnected
  ) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Please add your payment method first'
    );
  }

  if (!verifiedFlag) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'You account information is not verified, please verify your account first'
    );
  }

  if (payload.status === 'accepted') {
    let conflictingOrder;

    if (orderExists.isSetup) {
      conflictingOrder = await Order.findOne({
        vendorId: orderExists.vendorId,
        setupStartDateAndTime: { $lt: orderExists.deliveryDateAndTime },
        deliveryDateAndTime: { $gt: orderExists.setupStartDateAndTime },
        status: { $in: ['accepted', 'ongoing', 'started'] },
        _id: { $ne: id },
      });
    } else {
      conflictingOrder = await Order.findOne({
        vendorId: orderExists.vendorId,
        deliveryDateAndTime: orderExists.deliveryDateAndTime,
        status: { $in: ['accepted', 'ongoing', 'started'] },
        _id: { $ne: id },
      });
    }

    if (conflictingOrder) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        'The vendor already has an order during this time slot'
      );
    }

    if (orderExists.isSetup) {
      if (!payload.setupDuration) {
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          'Setup duration is required for setup orders'
        );
      }

      const setupDurationMs = getDuration(payload.setupDuration);
      const deliveryDate = new Date(orderExists.deliveryDateAndTime);
      const setupStartDateAndTime = new Date(
        deliveryDate.getTime() - setupDurationMs
      );

      if (isNaN(setupStartDateAndTime.getTime())) {
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          'Invalid setup start date calculation'
        );
      }

      payload.setupStartDateAndTime = setupStartDateAndTime;
      payload.setupFee = payload.setupFee || orderExists.setupFee;
    }
  }

  const result = await Order.findOneAndUpdate(
    { _id: id, status: 'pending' },
    { $set: { ...payload } },
    { new: true }
  );

  if (!result) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Failed to update order');
  }



  await sendDataWithSocket(
    payload?.status === 'accepted' ? 'acceptedOrder' : 'rejectedOrder',
    orderExists.customerId as Types.ObjectId,
    {
      ...result,
    }
  );



  const notificationTitle = `Order ${orderExists.orderId} has been ${payload?.status}`;
  const notificationMessage = `Order request for ID:${orderExists?.orderId} is ${payload?.status} by ${name}.`;
  const {_id:customerId} = customerExist;
  //TODO: send notification to vendor need testing
  await sendNotification('getNotification', customerId, {
    userId: customerId,
    title: notificationTitle,
    message: notificationMessage,
    type: USER_ROLES.CUSTOMER,
  },{
    deviceId: deviceId,
    destination: 'order',
    role: USER_ROLES.CUSTOMER,
    id: vendorId as unknown as string,
    icon: 'https://res.cloudinary.com/di2erk78w/image/upload/v1739447789/B694F238-61D7-490D-9F1B-3B88CD6DD094_1_1_kpjwlx.png'
  })
  return result;
};

const getDeliveryCharge = async (
  payload: { coordinates: number[] },
  vendorId: string
) => {
  const { coordinates } = payload;
  const vendor = await Vendor.findById(vendorId, { location: 1 });

  if (!vendor) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Vendor not found');
  }

  const location = vendor?.location;

  const distance = calculateDistance(
    [coordinates[0], coordinates[1]],
    [location.coordinates[0], location.coordinates[1]]
  );
  return (distance * Number(config.delivery_fee)).toFixed(2);

};

const startOrderDelivery = async (id: string) => {
  const isOrderExist = await Order.findById({ _id: id, status: 'ongoing' }).populate<{customerId:Partial<ICustomer>}>('customerId', { name: 1, deviceId:1 }).populate<{vendorId:Partial<IVendor>}>('vendorId', { name: 1, deviceId:1 });
  if (!isOrderExist) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Order not found');
  }

  //check if the vendor already has any other order as started
  const vendorExist = await Order.findOne({
    vendorId: isOrderExist.vendorId,
    status: { $in: ['started'] },
    _id: { $ne: id },
  });

  if (vendorExist) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'You already have an order in delivery process'
    );
  }

  const result = await Order.findOneAndUpdate(
    { _id: id, status: 'ongoing' },
    { $set: { status: 'started' } },
    { new: true }
  );

  if (!result) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Failed to change the order status'
    );
  }
  const ID = await User.getUserId(result.customerId as Types.ObjectId, USER_ROLES.CUSTOMER);
  await sendNotification(
    'getNotification',
    result.customerId as Types.ObjectId,
    {
      userId: ID,//customer user id
      title: `${result.orderId} delivery started`,
      message: `Order delivery for ID:${result.orderId} has been started. Track your order for more details.`,
      type: USER_ROLES.CUSTOMER,
    }
  );

  const {name:vendorName} = isOrderExist.vendorId;
  const {_id:customerId, deviceId:customerDeviceId} = isOrderExist.customerId;

  const notificationTitle = `Delivery has been started for order ${result.orderId}`;
  const notificationMessage = `${vendorName} has started Order delivery for ID:${result.orderId} has been started. Track your order for more details..`;

  //TODO: send notification to vendor need testing
  await sendNotification('getNotification', customerId!, {
    userId: customerId!,
    title: notificationTitle,
    message: notificationMessage,
    type: USER_ROLES.CUSTOMER,
  },{
    deviceId: customerDeviceId!,
    destination: 'order',
    role: USER_ROLES.CUSTOMER,
    id: customerId as unknown as string,
    icon: 'https://res.cloudinary.com/di2erk78w/image/upload/v1739447789/B694F238-61D7-490D-9F1B-3B88CD6DD094_1_1_kpjwlx.png'
  })


  await sendDataWithSocket('startedOrder', result.vendorId as Types.ObjectId, {
    ...result,
  });

  return result;
};

export const OrderService = {
  createOrder,
  getAllOrders,
  getSingleOrder,
  getAllOrderByUserId,
  declineOrder,
  rejectOrAcceptOrder,
  getDeliveryCharge,
  startOrderDelivery,
};
