import { model, Schema } from 'mongoose';
import { ICustomer, CustomerModel } from './customer.interface';

const customerSchema = new Schema<ICustomer, CustomerModel>(
  {
    id: {
      type: String,
      required: true,
      unique: true,
    },
    name: {
      type: String,
    },
    email: {
      type: String,
    },
    contact: {
      type: String,
      default: '',
    },
    countryCode: {
      type: String,
      default: 'US',
    },
    isContactVerified: {
      type: Boolean,
      default: false,
    },
    deviceId: {
      type: String,
    },
    profileImg: {
      type: String,
    },
    address: {
      _id: false,
      type: {
        street: { type: String, required: true },
        apartmentOrSuite: { type: String },
        city: { type: String, required: true },
        state: { type: String, required: true },
        zip: { type: String, required: true },
        country: { type: String, required: true, default: 'United States' },
      },
    },
    deliveryOption: {
      type: String,
      enum: ['Leave at the front door', 'Call upon arrival'],
      default: 'Call upon arrival',
    },
    receivePromotionalNotification: {
      type: Boolean,
      default: false,
    },
    receivePhoneNotifications:{
      type: Boolean,
      default: false
    },
    profileCompletion: {
      type: Number,
      default: 0,
    },
    verifiedFlag: {
      type: Boolean,
      default: false,
    },
    location: {
      type: { type: String, default: 'Point', enum: ['Point'] },
      coordinates: { type: [Number], default: [0, 0] }, // [longitude, latitude] // Default to [0, 0] if coordinates are not provided
    },
  },
  {
    timestamps: true,
  }
);

customerSchema.index({ location: '2dsphere' });

export const Customer = model<ICustomer, CustomerModel>(
  'Customer',
  customerSchema
);
