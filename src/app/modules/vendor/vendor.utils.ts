import { parse, format } from 'date-fns';
import { Order } from '../order/order.model';
import { Service } from '../service/service.model';
import { convertTo24Hour } from '../../../helpers/dateFormatHelper';
import { IVendor } from './vendor.interface';

// Helper function to convert 12-hour time format to 24-hour format
export const buildDateTimeFilter = async (
  serviceDate: string,
  serviceTime: string
) => {
  const parsedDate = parse(serviceDate, 'dd-MM-yyyy', new Date());
  const [startTimeStr, endTimeStr] = serviceTime.split(' - ');
  const serviceStartDateTime = new Date(
    `${format(parsedDate, 'yyyy-MM-dd')}T${convertTo24Hour(startTimeStr)}:00Z`
  );

  const serviceEndDateTime = new Date(
    `${format(parsedDate, 'yyyy-MM-dd')}T${convertTo24Hour(endTimeStr)}:00Z`
  );

  const busyVendorIds = await Order.find({
    status: 'accepted',
    $and: [
      {
        setupStartDateAndTime: { $lt: serviceEndDateTime },
        deliveryDateAndTime: { $gt: serviceStartDateTime },
      },
    ],
  }).distinct('vendorId');

  return busyVendorIds;
};

// Helper function to find vendor IDs by budget range in Service collection
export const findVendorsByBudget = async (
  minBudget?: number,
  maxBudget?: number
) => {
  const budgetConditions: { estBudget?: { $gte?: number; $lte?: number } } = {};

  if (minBudget !== undefined) {
    budgetConditions.estBudget = { $gte: minBudget };
  }
  if (maxBudget !== undefined) {
    budgetConditions.estBudget = {
      ...budgetConditions.estBudget,
      $lte: maxBudget,
    };
  }

  // Fetch vendor IDs that match the budget criteria
  const services = await Service.find(budgetConditions).distinct('vendorId');
  return services;
};

export const buildRangeFilter = (field: string, min?: number, max?: number) => {
  const rangeFilter: { $gte?: number; $lte?: number } = {};
  if (min !== undefined) rangeFilter.$gte = min;
  if (max !== undefined) rangeFilter.$lte = max;
  return Object.keys(rangeFilter).length > 0 ? { [field]: rangeFilter } : null;
};

//statistics
export const getDateRangeAndIntervals = (range: string) => {
  const months = parseInt(range, 10) || 1;
  const endDate = new Date();
  const startDate = new Date();
  startDate.setMonth(endDate.getMonth() - months);

  const intervalDays = (months * 30) / 10; // 3, 6, or 9 days based on months
  const intervalMilliseconds = intervalDays * 24 * 60 * 60 * 1000;

  const totalIntervals = Math.floor(
    (endDate.getTime() - startDate.getTime()) / intervalMilliseconds
  );

  // Generate intervals with default value of 0
  const intervals = Array.from({ length: totalIntervals }, (_, i) => ({
    key: `${i * intervalDays + 1}-${(i + 1) * intervalDays}`,
    value: 0,
  }));

  return { startDate, endDate, intervals, intervalMilliseconds };
};

// Generic function to map aggregated data to intervals
export const mapDataToIntervals = (
  intervals: { key: string; value: number }[],
  data: { _id: number; totalRevenue: number | number; count: number }[],
  field: 'totalRevenue' | 'count'
) => {
  data.forEach(({ _id, [field]: value }) => {
    if (_id === intervals.length) {
      intervals[intervals.length - 1].value += value;
    } else if (_id < intervals.length) {
      intervals[_id].value = value;
    }
  });
};

export const handleObjectUpdate = (
  payload: Record<string, unknown>,
  updatedData: Record<string, unknown>,
  prefix: string
) => {
  if (payload && Object.keys(payload).length > 0) {
    Object.keys(payload).forEach(key => {
      // Construct the dynamic key with the prefix
      const updatedKey = `${prefix}.${key}`;

      // Assign the value from payload to updatedData with the new key
      updatedData[updatedKey] = payload[key];
    });
  }

  return updatedData;
};

const requiredFields = [
  'contact',
  'isContactVerified',
  'address',
  'businessProfile',
  'businessTitle',
  'businessType',
  'businessAddress',
  'businessContact',
  'isBusinessContactVerified',
  'availableDays',
  'operationStartTime',
  'operationEndTime',
  'stripeConnected',
  'location'
];

export const calculateProfileCompletion = (vendor: IVendor): number => {

  let completedFields = 0;
  for (const field of requiredFields) {
    const fieldValue = vendor[field as keyof IVendor];

    if (fieldValue !== undefined && fieldValue !== null) {
      switch (field) {
        case 'isContactVerified':
        case 'isBusinessContactVerified':
        case 'stripeConnected':
          if (fieldValue === true) completedFields += 1;
          break;

        case 'address':
        case 'businessAddress':
          if (
            typeof fieldValue === 'object' &&
            Object.keys(fieldValue).length > 0
          ) {
            completedFields += 1;
          }
          break;
        case 'location':
          // Ensure location is valid
          if (
            typeof fieldValue === 'object' &&
            'type' in fieldValue &&
            fieldValue.type === 'Point' &&
            'coordinates' in fieldValue &&
            Array.isArray(fieldValue.coordinates) &&
            fieldValue.coordinates.length === 2 &&
            (fieldValue.coordinates[0] !== 0 || fieldValue.coordinates[1] !== 0) // Check that coordinates are not [0, 0]
          ) {
            completedFields += 1;
          }
          break;

        default:
          if (fieldValue !== undefined && fieldValue !== null) {
            completedFields += 1;
          }
      }
    }
  }

  const percentage = (completedFields / requiredFields.length) * 100;


  return Math.round(percentage);
};
