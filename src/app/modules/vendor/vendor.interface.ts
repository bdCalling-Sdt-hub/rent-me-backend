import { Model, Types } from 'mongoose';

type Point = {
  type: 'Point';
  coordinates: [number, number]; // [longitude, latitude]
};

type IAddress = {
  street: string;
  apartmentOrSuite: string;
  city: string;
  state: string;
  zip: string;
  country: string;
};

type ISocialLink = {
  facebook?: string;
  instagram?: string;
  twitter?: string;
  linkedin?: string;
  website?: string;
};

export type IVendor = {
  _id: Types.ObjectId;
  id: string;
  name: string;
  email: string;
  contact?: string;
  contactCountryCode?: string;
  isContactVerified?: boolean;
  profileImg?: string;
  address?: IAddress;
  rating?: number;
  totalReviews: number;
  verifiedFlag: boolean;
  orderCompleted?: number;
  isAvailable?: boolean; // order < 10 ? true : false
  deviceId: string;
  stripeId: string;
  stripeConnected: boolean;

  //business information
  businessProfile: string;
  businessTitle?: string;
  businessType?: [Types.ObjectId];
  businessAddress?: IAddress;
  businessContact?: string;
  isBusinessContactVerified: boolean;
  businessContactCountryCode?: string;
  businessEmail?: string;
  isBusinessEmailVerified: boolean;
  socialLinks: ISocialLink;
  yearsInBusiness?: number;
  isLicensed?: boolean;
  license?: string;
  description?: string;
  availableDays?: string[];
  operationStartTime?: string;
  operationEndTime?: string;
  profileCompletion: number;
  receivePhoneNotifications: boolean;

  signatureType?: 'Typed' | 'Digital';
  signature?: string;
  digitalSignature?: string;
  location: Point; // [longitude, latitude]
};

export type VendorModel = Model<IVendor>;

export type IVendorFilterableFields = {
  searchTerm?: string;
  id?: string;
  name?: string;
  businessTitle?: string;
  address?: string;
  email?: string;
  minRating?: number;
  maxRating?: number;
  totalReviews?: number;
  orderCompleted?: number;
  isAvailable?: boolean;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  minOrderCompleted?: number;
  maxOrderCompleted?: number;
  minReviews?: number;
  maxReviews?: number;
  category?: string;
  // schedule
  serviceDate?: string;
  serviceTime?: string;

  //budget
  minBudget?: number;
  maxBudget?: number;

  //distance
  radius?: number;
  customerLat?: number;
  customerLng?: number;
};
