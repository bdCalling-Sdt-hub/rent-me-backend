/* eslint-disable @typescript-eslint/no-explicit-any */
import { StatusCodes } from 'http-status-codes';
import ApiError from '../../../errors/ApiError';
import { Order } from './order.model';
import { USER_ROLES } from '../../../enums/user';
import config from '../../../config';
import { Types } from 'mongoose';
import { sendDataWithSocket, sendNotification } from '../../../helpers/sendNotificationHelper';
import { IVendor } from '../vendor/vendor.interface';
import { ICustomer } from '../customer/customer.interface';
import { DateTime } from 'luxon';
import { logger } from '../../../shared/logger';


const getLastOrderId = async () => {
  const lastOrderId = await Order.findOne({}).sort({ createdAt: -1 }).lean();

  return lastOrderId?.orderId ? lastOrderId.orderId : undefined;
};

export const generateCustomOrderId = async () => {
  const currentId = (await getLastOrderId()) || (0).toString().padStart(5, '0');
  let currentIdLength = currentId.length;
  if (currentIdLength < 5) currentIdLength = 5;

  const maxValue = Math.pow(10, currentIdLength) - 1;

  if (parseInt(currentId) >= maxValue) {
    currentIdLength += 1;
  }

  // Increment the ID and pad it to the new length
  const incrementedId = (parseInt(currentId) + 1)
    .toString()
    .padStart(currentIdLength, '0');

  return incrementedId;
};


export function calculateDistance(
  coords1: [number, number],
  coords2: [number, number]
): number {
  const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

  const [lon1, lat1] = coords1; // [longitude, latitude]
  const [lon2, lat2] = coords2;
  //convert km to miles
  const R = 3959; // Radius of the Earth in miles

  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c; // Distance in miles

  return Number(distance.toFixed(2));
}


export const convertTo24Hour = (time12hr: string) => {
  const match = time12hr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid time format. Use HH:MM AM/PM');
  }

  let hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  const period = match[3].toUpperCase();

  if (period === 'PM' && hour !== 12) {
    hour += 12;
  } else if (period === 'AM' && hour === 12) {
    hour = 0;
  }

  return { hour, minute };
};

export const validateOrderTime = (
  serviceDateTime: Date,
  vendorOperationStart: string,
  vendorOperationEnd: string,
  vendorTimezone: string
) => {
  try {
    const serviceTime = DateTime.fromJSDate(serviceDateTime, { zone: vendorTimezone });
    
    // Convert vendor hours to DateTime objects in their timezone
    const { hour: startHour, minute: startMinute } = convertTo24Hour(vendorOperationStart);
    const { hour: endHour, minute: endMinute } = convertTo24Hour(vendorOperationEnd);
    
    const operationStart = serviceTime.set({ hour: startHour, minute: startMinute });
    let operationEnd = serviceTime.set({ hour: endHour, minute: endMinute });

    // Handle overnight operations (e.g., 8 PM to 2 AM)
    if (operationEnd <= operationStart) {
      operationEnd = operationEnd.plus({ days: 1 });
    }

    if (serviceTime < operationStart || serviceTime > operationEnd) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `Order time must be between ${vendorOperationStart} and ${vendorOperationEnd} (${vendorTimezone})`
      );
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid time validation parameters');
  }
};

export const getDuration = (duration: string): number => {
  // Handle multiple formats: '2hr', '30min', '3d', '02:30' (hours:minutes), '1:00:00' (days:hours:minutes)
  const timeUnits: { [key: string]: number } = {
    min: 60 * 1000, // minute in milliseconds
    hr: 60 * 60 * 1000, // hour in milliseconds
    d: 24 * 60 * 60 * 1000, // day in milliseconds
  };

  // Try simple format first (e.g., 2hr)
  const simpleMatch = duration.match(/^(\d+)(min|hr|d)$/);
  if (simpleMatch) {
    const value = parseInt(simpleMatch[1], 10);
    const unit = simpleMatch[2] as keyof typeof timeUnits;
    return value * timeUnits[unit];
  }

  // Try complex formats
  const parts = duration.split(':').map(part => parseInt(part, 10));
  if (parts.length === 3) { // days:hours:minutes
    const [days, hours, minutes] = parts;
    return days * timeUnits.d + hours * timeUnits.hr + minutes * timeUnits.min;
  }

  if (parts.length === 2) { // hours:minutes
    const [hours, minutes] = parts;
    return hours * timeUnits.hr + minutes * timeUnits.min;
  }

  throw new ApiError(
    StatusCodes.BAD_REQUEST,
    'Invalid duration format. Use formats like "2hr", "30min", "3d", "02:30", or "1:00:00".'
  );
};



export const parseDuration = (duration: string): number => {
  const timeUnits: { [key: string]: number } = {
    min: 60 * 1000, // minute in milliseconds
    hr: 60 * 60 * 1000, // hour in milliseconds
    d: 24 * 60 * 60 * 1000, // day in milliseconds
  };

  const match = duration.match(/^(\d+)(min|hr|d)$/);
  if (!match) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Invalid setup duration format.'
    );
  }

  const value = parseInt(match[1], 10);
  const unit = match[2] as keyof typeof timeUnits; // Cast `unit` to a valid key of `timeUnits`

  return value * timeUnits[unit];
};






export const calculateOrderCharges = (
  order:any,
  userRole:string,
) => {
  const applicationChargeRate = Number(config.application_fee);
  const ccChargeRate = Number(config.customer_cc_rate);
  const instantTransferFeeRate = Number(config.instant_transfer_fee);

  const enrichedOrder = { ...order };

  // Validate required fields
  if (!order?.amount && !order?.offeredAmount) {
    throw new Error("Either amount or offeredAmount must be provided.");
  }

  const orderAmount = order?.amount || order.offeredAmount;

  // Calculate CC charge for customers
  if (userRole === USER_ROLES.CUSTOMER) {
    enrichedOrder.customerCCChargeRate = ccChargeRate;
    enrichedOrder.customerCCCharge = orderAmount * ccChargeRate;
  }

  // Calculate vendor-specific fields
  if (userRole === USER_ROLES.VENDOR) {
    const applicationCharge = Math.floor(
      orderAmount *
      (order.isInstantTransfer ? instantTransferFeeRate : applicationChargeRate)
    );

    const instantTransferFee = order.isInstantTransfer
      ? Math.floor(orderAmount * instantTransferFeeRate)
      : 0;

    if (order.isInstantTransfer) {
      enrichedOrder.instantTransferChargeRate = instantTransferFeeRate;
      enrichedOrder.instantTransferCharge = instantTransferFee;
    } else {
      enrichedOrder.applicationChargeRate = applicationChargeRate;
    }

    enrichedOrder.vendorReceivable = Math.floor(
      orderAmount +
      (order.isSetup ? order?.setupFee : 0) +
      order.deliveryFee -
      (applicationCharge + instantTransferFee) -
      (enrichedOrder.customerCCCharge || 0)
    );

    enrichedOrder.applicationCharge = applicationCharge;
  }

  // Calculate subTotal including optional fields
  const setupFee = order.setupFee || 0;
  const deliveryCharge = order.deliveryFee || 0;
  enrichedOrder.subTotal = Math.floor(
    orderAmount + setupFee + deliveryCharge + (enrichedOrder.customerCCCharge || 0)
  );

  return enrichedOrder;
};



export const orderNotificationAndDataSendWithSocket = async (
  namespace: string,
  orderId: Types.ObjectId | string,
  role: USER_ROLES,
  notificationData: { title: string; message: string }
) => {
  try {
    const order = await Order.findById(orderId)
      .populate<{ vendorId: Partial<IVendor> }>('vendorId', {
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
        deviceId: 1,
      })
      .populate('packageId', { title: 1 })
      .populate('serviceId', { title: 1, price: 1 })
      .populate('paymentId')
      .populate<{ customerId: Partial<ICustomer> }>('customerId', {
        name: 1,
        email: 1,
        phone: 1,
        address: 1,
        profileImg: 1,
        deviceId: 1,
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
      .lean();

    if (!order) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Order not found');
    }

    const enrichData = calculateOrderCharges(order, role);
    const vendor = order.vendorId;
    const customer = order.customerId;

    const destinationDeviceId =
      role === USER_ROLES.VENDOR ? vendor?.deviceId : customer?.deviceId;
    const destinationUserId =
      role === USER_ROLES.VENDOR ? vendor?._id : customer?._id;

    const { title, message } = notificationData;

    // Run both operations independently
    try {
      // Emit socket event
      await sendDataWithSocket(namespace, destinationUserId!, enrichData);
    } catch (error) {
      logger.error('Error sending socket event:', error);
    }

    try {
      // Send push notification
      await sendNotification(
        'getNotification',
        destinationUserId!,
        {
          userId: destinationUserId as Types.ObjectId,
          title,
          message,
          type: role,
        },
        {
          deviceId: destinationDeviceId!,
          destination: 'order',
          role: role,
          id: destinationUserId! as unknown as string,
          icon:
            'https://res.cloudinary.com/di2erk78w/image/upload/v1739447789/B694F238-61D7-490D-9F1B-3B88CD6DD094_1_1_kpjwlx.png',
        }
      );
    } catch (error) {
      logger.error('Error sending push notification:', error);
    }
  } catch (error) {
    logger.error('Error processing order notification and socket:', error);
    // Continue even if the notification or socket fails
  }
};

