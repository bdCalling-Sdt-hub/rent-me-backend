import { z } from 'zod';

const createOrderZodSchema = z.object({
  body: z.object({
    vendorId: z.string().nonempty('Vendor ID is required'), // Expecting ObjectId as a string
    serviceId: z.string().nonempty().optional(), // Expecting ObjectId as a string
    packageId: z.string().nonempty().optional(), // Expecting ObjectId as a string
    // amount: z.number().min(0, 'Amount must be a positive number'),
    preference: z.string().optional(),
    isCustomOrder: z.boolean().optional(),
    products: z
      .array(
        z.object({
          product: z.string(),
          price: z.number(),
          quantity: z.number(),
        })
      )
      .optional(),
    offeredAmount: z
      .number()
      .min(0, 'Offered amount must be a positive number'),
    deliveryAddress: z.string().nonempty('Delivery address is required'),
    customOrderDuration: z.string().optional(),
    priceType: z.string().optional(),
    setupFee: z.number().optional(),
    isSetup: z.boolean().optional(),
    setupDuration: z.string().optional(),
    setupStartDateAndTime: z.string().optional(),
    deliveryDateAndTime: z.string({
      required_error: 'Delivery date is required',
    }),
  }),
});

const updateOrderStatusValidationForVendor = z.object({
  body: z.object({
    status: z.enum(['accepted', 'rejected', 'started'], {
      required_error: 'Status is required',
    }),
    setupFee: z.number().optional(),
    setupDuration: z.string().optional(),
    deliveryFee: z.number().optional(),
    amount: z.number().optional(),
  }),
});

const updateOrderStatusValidationForCustomer = z.object({
  body: z.object({
    deliveryDeclineMessage: z.string({required_error:"Reason to decline the order is required."}),
  }),
});
export const OrderValidation = {
  createOrderZodSchema,
  updateOrderStatusValidationForVendor,
  updateOrderStatusValidationForCustomer,
};
