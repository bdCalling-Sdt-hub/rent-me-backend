import { StatusCodes } from 'http-status-codes';
import ApiError from '../../../errors/ApiError';
import { Vendor } from './vendor.model';
import { IVendor, IVendorFilterableFields } from './vendor.interface';
import { JwtPayload } from 'jsonwebtoken';
import { User } from '../user/user.model';
import { userSearchableFields } from '../user/user.constants';
import { SortOrder, Types } from 'mongoose';
import {
  buildDateTimeFilter,
  buildRangeFilter,
  findVendorsByBudget,
} from './vendor.utils';
import { Service } from '../service/service.model';
import { Order } from '../order/order.model';
import { getEvenlyDistributedData } from '../../../helpers/statDataHelper';
import { getStartDate } from '../../../util/date';

const updateVendorProfile = async (
  user: JwtPayload,
  payload: Partial<IVendor>
) => {
  const { id, userId } = user;

  const isExistUser = await User.isExistUserById(id);
  if (!isExistUser) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User doesn't exist!");
  }

  console.log(payload);

  const result = await Vendor.findOneAndUpdate({ _id: userId }, payload, {
    new: true,
  });

  //need to be fixed!!!
  if (!result) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Failed to update vendor');
  }

  return result;
};

const getVendorProfile = async (user: JwtPayload) => {
  const { id, userId } = user;

  const isExistUser = await User.isExistUserById(id);
  if (!isExistUser) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User doesn't exist!");
  }

  const result = await Vendor.findById({ _id: userId });
  if (!result) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Failed to get vendor profile');
  }

  // Get the count of services for this vendor
  const serviceCount = await Service.countDocuments({ vendorId: userId });

  const vendorObjectId = new Types.ObjectId(userId);

  // Calculate the total revenue from completed orders
  const revenueResult = await Order.aggregate([
    {
      $match: {
        vendorId: vendorObjectId,
        status: 'completed', // Filter by completed orders
      },
    },
    {
      $group: {
        _id: null,
        totalRevenue: { $sum: '$amount' },
      },
    },
  ]);
  console.log(revenueResult);
  const totalRevenue = revenueResult[0]?.totalRevenue || 0;

  return {
    ...result.toObject(),
    serviceCount,
    totalRevenue,
  };
};

const getSingleVendor = async (id: string) => {
  const result = await Vendor.findOne({ id: id });
  if (!result) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Failed to get vendor');
  }
  return result;
};

const deleteVendorProfile = async (user: JwtPayload) => {
  const { id, userId } = user;

  const isExistUser = await User.isExistUserById(id);
  if (!isExistUser) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User doesn't exist!");
  }

  const result = await User.findOneAndUpdate({ _id: id }, { status: 'delete' });

  if (!result) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Failed to delete vendor');
  }
};

const getAllVendor = async (filters: IVendorFilterableFields) => {
  const {
    searchTerm,
    sortBy,
    sortOrder,
    minOrderCompleted,
    maxOrderCompleted,
    minReviews,
    maxReviews,
    minRating,
    maxRating,
    serviceDate,
    serviceTime,
    minBudget,
    maxBudget,
    customerLat,
    customerLng,
    radius,
    ...filterData
  } = filters;
  const andCondition = [];

  if (searchTerm) {
    andCondition.push({
      $or: userSearchableFields.map(field => ({
        [field]: {
          $regex: searchTerm,
          $options: 'i',
        },
      })),
    });
  }

  if (Object.keys(filterData).length) {
    andCondition.push({
      $and: Object.entries(filterData).map(([field, value]) => ({
        [field]: value,
      })),
    });
  }

  //Check whether a vendor is available or not for a given date and time range
  if (serviceDate && serviceTime) {
    const busyVendorIds = await buildDateTimeFilter(serviceDate, serviceTime);
    andCondition.push({
      _id: { $nin: busyVendorIds },
    });
  }

  // Budget range filtering based on service data
  if (minBudget !== undefined || maxBudget !== undefined) {
    const budgetVendorIds = await findVendorsByBudget(minBudget, maxBudget);
    andCondition.push({
      _id: { $in: budgetVendorIds },
    });
    console.log(budgetVendorIds);
  }

  // Add range filters
  const orderCompletedFilter = buildRangeFilter(
    'orderCompleted',
    minOrderCompleted,
    maxOrderCompleted
  );
  if (orderCompletedFilter) andCondition.push(orderCompletedFilter);

  const ratingFilter = buildRangeFilter('rating', minRating, maxRating);
  if (ratingFilter) andCondition.push(ratingFilter);

  const reviewsFilter = buildRangeFilter(
    'totalReviews',
    minReviews,
    maxReviews
  );
  if (reviewsFilter) andCondition.push(reviewsFilter);

  // Radius filter based on customer location
  console.log(customerLat, customerLng, radius);
  if (customerLat && customerLng && radius) {
    andCondition.push({
      location: {
        $geoWithin: {
          $centerSphere: [
            [Number(customerLat), Number(customerLng)], // [lng, lat] format for GeoJSON
            radius / 6378.1, // Radius in radians (6378.1 is Earth's radius in kilometers)
          ],
        },
      },
    });
  }

  //check if rating based sorting is needed
  const sortConditions: { [key: string]: SortOrder } = {};
  if (sortBy && sortOrder) {
    sortConditions[sortBy] = sortOrder;
  }

  const whereConditions = andCondition.length > 0 ? { $and: andCondition } : {};

  const result = await Vendor.find(whereConditions, {
    id: 1,
    name: 1,
    email: 1,
    rating: 1,
    totalReviews: 1,
    orderCompleted: 1,
    isAvailable: 1,
    contact: 1,
    address: 1,
  }).lean();

  return result;
};

//Analytics

const getVendorRevenue = async (user: JwtPayload, range: string) => {
  const startDate = getStartDate(range);
  const endDate = new Date(); // Current date

  console.log(startDate, endDate);

  try {
    const revenueData = await Order.aggregate([
      {
        $match: {
          vendorId: new Types.ObjectId(user.userId),
          status: 'completed',
          serviceStartDateTime: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$serviceStartDateTime',
            },
          }, // Group by day
          totalRevenue: { $sum: '$offeredAmount' },
        },
      },
      {
        $sort: { _id: 1 }, // Sort by date in ascending order
      },
    ]);
    console.log(revenueData);

    // Select 10 evenly distributed data points for chart visualization
    const evenlyDistributedData = getEvenlyDistributedData(revenueData, 10);

    // Format the response data for the chart
    const chartData = evenlyDistributedData.map((data: any) => ({
      date: data._id,
      revenue: data.totalRevenue,
    }));

    return chartData;
  } catch (error) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Failed to get vendor revenue');
  }
};

export const VendorService = {
  updateVendorProfile,
  getVendorProfile,
  getSingleVendor,
  deleteVendorProfile,
  getAllVendor,
  getVendorRevenue,
};