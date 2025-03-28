import { Model, Types } from 'mongoose';
import { USER_ROLES } from '../../../enums/user';

export type IPrivacyPolicy = {
  content: string;
  userType: USER_ROLES.CUSTOMER | USER_ROLES.VENDOR | 'USER';
};

export type ITermsAndConditions = {
  content: string;
  userType: USER_ROLES.CUSTOMER | USER_ROLES.VENDOR | 'USER';
};

export type IFaQs = {
  content: string;
  userType: USER_ROLES.CUSTOMER | USER_ROLES.VENDOR | 'USER';
};

export type IBanner = {
  title: string;
  description: string;
  link?: string;
  isActive: boolean;
  btnText: string;
  imgUrl: string;
  createdBy: Types.ObjectId;
};

export type PrivacyPolicyModel = Model<IPrivacyPolicy>;
export type TermsAndConditionsModel = Model<ITermsAndConditions>;
export type FaQsModel = Model<IFaQs>;
export type BannerModel = Model<IBanner>;
