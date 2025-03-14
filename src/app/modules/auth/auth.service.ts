import { jwtHelper } from './../../../helpers/jwtHelper';
import { USER_ROLES } from './../../../enums/user';
import bcrypt from 'bcrypt';
import { StatusCodes } from 'http-status-codes';
import { JwtPayload, Secret } from 'jsonwebtoken';
import config from '../../../config';
import ApiError from '../../../errors/ApiError';
import { emailHelper } from '../../../helpers/emailHelper';

import { emailTemplate } from '../../../shared/emailTemplate';
import {
  IAuthResetPassword,
  IChangePassword,
  ILoginData,
  IVerifyEmail,
} from '../../../types/auth';
import cryptoToken from '../../../util/cryptoToken';
import generateOTP from '../../../util/generateOTP';
import { ResetToken } from '../resetToken/resetToken.model';
import { User } from '../user/user.model';
import { ILoginResponse, IRefreshTokenResponse } from '../../../types/response';

import { Customer } from '../customer/customer.model';
import { Vendor } from '../vendor/vendor.model';
import { sendOtp, verifyOtp } from '../../../helpers/twilioHelper';
import { IVendor } from '../vendor/vendor.interface';
import { calculateCustomerProfileCompletion } from '../customer/customer.utils';
import { calculateProfileCompletion } from '../vendor/vendor.utils';
import { ICustomer } from '../customer/customer.interface';
import { Order } from '../order/order.model';
import mongoose from 'mongoose';
import { generateCustomIdBasedOnRole } from '../user/user.utils';
import { Types } from 'mongoose';
import { createTokens } from './auth.utils';

//login
const loginUserFromDB = async (
  payload: ILoginData
): Promise<ILoginResponse> => {
  const { email, password } = payload;

  const isExistUser = await User.findOne({ email, status: { $in: ['active', 'restricted'] } }).select('+password');
  if (!isExistUser) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist!");
  }

  if (isExistUser.status === 'restricted') {
    if (
      isExistUser.restrictionLeftAt &&
      new Date() < isExistUser.restrictionLeftAt
    ) {
      const remainingMinutes = Math.ceil(
        (isExistUser.restrictionLeftAt.getTime() - Date.now()) / 60000
      );
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `You are restricted to login for ${remainingMinutes} minutes`
      );
    }

    isExistUser.status = 'active';
    isExistUser.wrongLoginAttempts = 0;
    isExistUser.restrictionLeftAt = null;

    await User.findByIdAndUpdate(
      { _id: isExistUser._id },
      {
        $set: {
          status: isExistUser.status,
          wrongLoginAttempts: isExistUser.wrongLoginAttempts,
          restrictionLeftAt: isExistUser.restrictionLeftAt,
        },
      }
    );
  }

  //check verified and status
  if (!isExistUser.verified && isExistUser.role !== USER_ROLES.ADMIN) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Please verify your account, then try to login again'
    );
  }

  //check user status
  if (isExistUser.status === 'delete') {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Account with this email does not exist or has been deleted. Please register again.'
    );
  }

  //check match password
  if (!await bcrypt.compare(password, isExistUser.password)) {
    isExistUser.wrongLoginAttempts += 1;

    if (isExistUser.wrongLoginAttempts >= 5) {
      isExistUser.status = 'restricted';
      isExistUser.restrictionLeftAt = new Date(Date.now() + 10 * 60 * 1000); // Restrict for 1 day
    }

    await User.findByIdAndUpdate(
      { _id: isExistUser._id },
      {
        $set: {
          wrongLoginAttempts: isExistUser.wrongLoginAttempts,
          status: isExistUser.status,
          restrictionLeftAt: isExistUser.restrictionLeftAt,
        },
      }
    );

    throw new ApiError(StatusCodes.BAD_REQUEST, 'Password is incorrect!');
  }



  //update device id based on role
  if (isExistUser.role === USER_ROLES.CUSTOMER) {
    await Customer.findOneAndUpdate(
      { _id: isExistUser.customer },
      { $set: { deviceId: payload.deviceId }, new:true }
    );
  } else if (isExistUser.role === USER_ROLES.VENDOR) {
    await Vendor.findOneAndUpdate(
      { _id: isExistUser.vendor },
      { $set: { deviceId: payload.deviceId },new:true }
    );
  }


  //create accessToken token
  const accessToken = jwtHelper.createToken(
    {
      id: isExistUser._id, //user collection id
      userCustomId: isExistUser.id, // user custom id
      userId:
        isExistUser.role === USER_ROLES.CUSTOMER
          ? isExistUser.customer
          : isExistUser.role === USER_ROLES.VENDOR
          ? isExistUser.vendor
          : isExistUser.admin,
      role: isExistUser.role,
    },
    config.jwt.jwt_secret as Secret,
    config.jwt.jwt_expire_in as string
  );

  const refreshToken = jwtHelper.createToken(
    {
      id: isExistUser._id, //user collection id
      userCustomId: isExistUser.id, // user custom id
      userId:
        isExistUser.role === USER_ROLES.CUSTOMER
          ? isExistUser.customer
          : isExistUser.role === USER_ROLES.VENDOR
          ? isExistUser.vendor
          : isExistUser.admin,
      role: isExistUser.role,
    },
    config.jwt.jwt_refresh_secret as Secret,
    config.jwt.jwt_refresh_expire_in as string
  );



  return { accessToken, refreshToken, role: isExistUser.role };
};

const refreshToken = async (
  token: string
): Promise<IRefreshTokenResponse | null> => {
  let verifiedToken = null;
  try {
    // Verify the refresh token
    verifiedToken = jwtHelper.verifyToken(
      token,
      config.jwt.jwt_refresh_secret as Secret
    );
  } catch (error) {
    if (error instanceof Error) {
      throw new ApiError(StatusCodes.UNAUTHORIZED, 'You are not authorized');
    }
    throw new ApiError(StatusCodes.FORBIDDEN, 'Invalid Refresh Token');
  }

  const { email } = verifiedToken;

  const isUserExist = await User.isExistUserByEmail(email);
  if (!isUserExist) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'User not found!');
  }

  const newAccessToken = jwtHelper.createToken(
    {
      id: isUserExist._id,
      userId:
        isUserExist.role === USER_ROLES.CUSTOMER
          ? isUserExist.customer
          : isUserExist.role === USER_ROLES.VENDOR
          ? isUserExist.vendor
          : isUserExist.admin,
      role: isUserExist.role,
    },
    config.jwt.jwt_secret as Secret,
    config.jwt.jwt_expire_in as string
  );
  

  return {
    accessToken: newAccessToken,
  };
};

//forget password
const forgetPasswordToDB = async (email: string) => {
  const isExistUser = await User.isExistUserByEmail(email);
  if (!isExistUser) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist!");
  }

  //send mail
  const otp = generateOTP();
  const value = {
    otp,
    email: isExistUser.email,
  };
  const forgetPassword = emailTemplate.resetPassword(value);
  emailHelper.sendEmail(forgetPassword);

  //save to DB
  const authentication = {
    oneTimeCode: otp,
    expireAt: new Date(Date.now() + 5 * 60000),
  };
  await User.findOneAndUpdate({ email }, { $set: { authentication } });
};

//verify email
const verifyEmailToDB = async (payload: IVerifyEmail) => {
  const { email, oneTimeCode } = payload;

  const isExistUser = await User.findOne({ email }).select('+authentication');
  if (!isExistUser) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist!");
  }

  if (!Number(oneTimeCode)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Please give the otp, check your email we send a code'
    );
  }

  if (isExistUser.authentication?.oneTimeCode !== Number(oneTimeCode)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'You provided wrong otp');
  }

  const date = new Date();
  if (date > isExistUser.authentication?.expireAt) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Otp already expired, Please try again'
    );
  }

  let message;
  let data;

  if (!isExistUser.verified) {
    await User.findOneAndUpdate(
      { _id: isExistUser._id },
      { verified: true, authentication: { Number: null, expireAt: null } }
    );
    message = 'Email verify successfully';
  } else {
    await User.findOneAndUpdate(
      { _id: isExistUser._id },
      {
        authentication: {
          isResetPassword: true,
          oneTimeCode: null,
          expireAt: null,
        },
      }
    );

    //create token ;
    const createToken = cryptoToken();
    await ResetToken.create({
      user: isExistUser._id,
      token: createToken,
      expireAt: new Date(Date.now() + 5 * 60000),
    });
    message =
      'Verification Successful: Please securely store and utilize this code for reset password';
    data = createToken;
  }
  return { data, message };
};

//forget password
const resetPasswordToDB = async (
  token: string,
  payload: IAuthResetPassword
) => {
  const { newPassword, confirmPassword } = payload;
  //isExist token
  const isExistToken = await ResetToken.isExistToken(token);
  if (!isExistToken) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'You are not authorized');
  }

  //user permission check
  const isExistUser = await User.findById(isExistToken.user).select(
    '+authentication'
  );
  if (!isExistUser?.authentication?.isResetPassword) {
    throw new ApiError(
      StatusCodes.UNAUTHORIZED,
      "You don't have permission to change the password. Please click again to 'Forgot Password'"
    );
  }

  //validity check
  const isValid = await ResetToken.isExpireToken(token);
  if (!isValid) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Token expired, Please click again to the forget password'
    );
  }

  //check password
  if (newPassword !== confirmPassword) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "New password and Confirm password doesn't match!"
    );
  }

  const hashPassword = await bcrypt.hash(
    newPassword,
    Number(config.bcrypt_salt_rounds)
  );

  const updateData = {
    password: hashPassword,
    authentication: {
      isResetPassword: false,
    },
  };

  await User.findOneAndUpdate({ _id: isExistToken.user }, updateData, {
    new: true,
  });
};

const changePasswordToDB = async (
  user: JwtPayload,
  payload: IChangePassword
) => {
  const { currentPassword, newPassword, confirmPassword } = payload;

  //new password and confirm password check
  if (newPassword !== confirmPassword) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Password and Confirm password doesn't matched"
    );
  }

  const isExistUser = await User.findById(user.id).select('+password');
  if (!isExistUser) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist!");
  }

  //current password match
  if (
    currentPassword &&
    !(await User.isMatchPassword(currentPassword, isExistUser.password))
  ) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Password is incorrect');
  }

  //newPassword and current password
  if (currentPassword === newPassword) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Please give different password from current password'
    );
  }

  //hash password
  const hashPassword = await bcrypt.hash(
    newPassword,
    Number(config.bcrypt_salt_rounds)
  );

  const updateData = {
    password: hashPassword,
  };
  await User.findOneAndUpdate({ _id: user.id }, updateData, { new: true });
};

const resendOtp = async (email: string) => {
  const isExistUser = await User.findOne({ email: email })
    .populate({ path: 'customer', select: { name: 1 } })
    .populate({ path: 'vendor', select: { name: 1 } });
  if (!isExistUser) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist!");
  }

  //send mail
  const otp = generateOTP();
  const value = {
    name:
      isExistUser.role === USER_ROLES.CUSTOMER &&
      isExistUser.customer &&
      'name' in isExistUser.customer
        ? isExistUser.customer.name
        : isExistUser.role === USER_ROLES.VENDOR &&
          isExistUser.vendor &&
          'name' in isExistUser.vendor
        ? isExistUser.vendor.name
        : '',
    otp,
    email: isExistUser.email,
  };
  const forgetPassword = emailTemplate.createAccount(value);
  emailHelper.sendEmail(forgetPassword);

  //save to DB
  const authentication = {
    oneTimeCode: otp,
    expireAt: new Date(Date.now() + 3 * 60000),
  };
  await User.findOneAndUpdate({ email }, { $set: { authentication } });
};

const sendOtpToPhone = async (user: JwtPayload, phone: string) => {
  // Fetch user with necessary fields
  const userDoc = await User.findById(user.id)
    .select('role customer vendor')
    .populate<{vendor:Partial<IVendor>}>({
      path: 'vendor',
      select: 'contact businessContact isBusinessContactVerified isContactVerified receivePhoneNotifications',
    })
    .populate<{customer:Partial<ICustomer>}>({
      path: 'customer',
      select: 'contact isContactVerified receivePhoneNotifications',
    })
    .lean();

  if (!userDoc) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist!");
  }


  if((userDoc.role === USER_ROLES.CUSTOMER && !userDoc.customer.receivePhoneNotifications) || (userDoc.role === USER_ROLES.VENDOR && !userDoc.vendor.receivePhoneNotifications) ) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Please enable phone notifications to continue.'
    );
  }


  // Check if the phone number is already verified based on the user's role
  if (userDoc.role === USER_ROLES.CUSTOMER) {
    const { isContactVerified, contact } = userDoc.customer as ICustomer;

    if (contact === phone && isContactVerified) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        'Phone number is already verified, please choose another number and try again.'
      );
    }

  } else if (userDoc.role === USER_ROLES.VENDOR) {
    const { isContactVerified, businessContact, contact, isBusinessContactVerified } = userDoc.vendor as IVendor;

    if ((contact === phone && isContactVerified) || (businessContact === phone && isBusinessContactVerified)) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        'Phone number is already verified'
      );
    }
  }

  // Send OTP to the phone
  await sendOtp(phone);
};

const verifyOtpForPhone = async (
  user: JwtPayload,
  phone: string,
  countryCode: string,
  isoCode: string,
  otp: string,
  type?: string
) => {
  // Fetch user with necessary fields
  const userDoc = await User.findById(user.id)
    .select('role customer vendor')
    .populate({
      path: 'vendor',
      select: 'contact businessContact isBusinessContactVerified businessContactCountryCode contactCountryCode',
    })
    .populate({
      path: 'customer',
      select: 'contact isContactVerified contactCountryCode',
    })
    .lean();

  if (!userDoc) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist!");
  }

  // Verify OTP
  const isVerified = await verifyOtp((countryCode + phone), otp);
  if (!isVerified) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid OTP');
  }

  // Update user data based on role
  if (userDoc.role === USER_ROLES.CUSTOMER) {
    const customerUpdate = {
      isContactVerified: true,
      contact: phone,
      contactCountryCode: isoCode,
    };

    const updatedCustomer = await Customer.findByIdAndUpdate(
      userDoc.customer,
      { $set: customerUpdate },
      { new: true }
    );

    if (!updatedCustomer) {
      throw new Error('Failed to update customer data.');
    }

    const profileCompletion = calculateCustomerProfileCompletion(updatedCustomer);
    await Customer.findByIdAndUpdate(updatedCustomer._id, {
      $set: {
        profileCompletion: profileCompletion,
        verifiedFlag: updatedCustomer.verifiedFlag || profileCompletion === 100,
      },
    });

  } else if (userDoc.role === USER_ROLES.VENDOR) {
    const vendor = userDoc.vendor as IVendor;
    if (!vendor) {
      throw new Error('Vendor data not found.');
    }

    const vendorUpdate = type === 'business'
      ? { isBusinessContactVerified: true, businessContact: phone, businessContactCountryCode: isoCode }
      : { isContactVerified: true, contact: phone, contactCountryCode: isoCode };

    const updatedVendor = await Vendor.findByIdAndUpdate(
      vendor._id,
      { $set: vendorUpdate },
      { new: true }
    );

    if (!updatedVendor) {
      throw new Error('Failed to update vendor data.');
    }

    const profileCompletion = calculateProfileCompletion(updatedVendor);
    await Vendor.findByIdAndUpdate(updatedVendor._id, {
      $set: {
        profileCompletion: profileCompletion,
        verifiedFlag: updatedVendor.verifiedFlag || profileCompletion === 100,
      },
    });
  }
};

const updateUserAppId = async (user: JwtPayload, appId: string) => {
  const isUserExist = await User.findById(user.id);
  if (!isUserExist) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist!");
  }

  if (isUserExist.appId === appId) {
    return;
  }

  await User.findOneAndUpdate(
    { _id: user.id },
    { $set: { appId } },
    { new: true }
  );
};

const deleteAccount = async (user: JwtPayload, password: string) => {
  const isUserExist = await User.findById(user.id, '+password');
  if (!isUserExist) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist!");
  }

  const isPasswordMatched = await User.isMatchPassword(
    password,
    isUserExist.password
  );

  if (!isPasswordMatched) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Password is incorrect');
  }

  if (isUserExist.role === USER_ROLES.VENDOR) {
    // Check for running orders
    const hasRunningOrder = await Order.exists({
      vendorId: isUserExist.vendor,
      status: { $in: ['ongoing', 'accepted'] },
    });

    if (hasRunningOrder) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        'You have ongoing orders. Please complete them before deleting your profile.'
      );
    }
  }

  if (isUserExist.status === 'delete') {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'User already deleted!');
  }

  await User.findByIdAndUpdate(
    { _id: user.id },
    { $set: { status: 'delete' } }
  );

  return isUserExist;
};

const socialLogin = async (socialId: string,deviceId: string) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const isUserExist = await User.findOne({ appId: socialId, status: { $in: ['active', 'restricted'] } , role: USER_ROLES.CUSTOMER}).session(session);

    if (isUserExist) {
      const tokens = createTokens(isUserExist._id, isUserExist?.customer as Types.ObjectId);
      await session.commitTransaction();
      return tokens;
    } else {
      const id = await generateCustomIdBasedOnRole(USER_ROLES.CUSTOMER);
      
      const newCustomer = await Customer.create([{ id: id, deviceId: deviceId }], { session });
      
      
      const newUser = await User.create([{ id: id, appId: socialId, role: USER_ROLES.CUSTOMER,password:"hello-world!", customer: newCustomer[0]._id }], { session });

      if (!newUser || !newCustomer) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'User or Customer creation failed');
      }


      const tokens = createTokens(newUser[0]._id, newCustomer[0]._id);
      await session.commitTransaction();
      return tokens;
    }
  } catch (error) {
    await session.abortTransaction();
    throw error;
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Social login failed');
  } finally {
    session.endSession();
  }
};


const restrictOrActivateUser = async (user: JwtPayload, id:Types.ObjectId) => {
  const isUserExist = await User.findById(id);

  if(!isUserExist){
    throw new ApiError(StatusCodes.BAD_REQUEST, 'User does not exist.');
  }
  if(isUserExist.status === 'active'){
    await User.findByIdAndUpdate(
      id,
      { $set: { status: 'restricted' } },
      { new: true }
    )
  }
  await User.findByIdAndUpdate(
    id,
    { $set: { status: 'active' } },
    { new: true }
  )

  return `User status updated to ${isUserExist.status}`

}



const toggleUserPermission = async (user: JwtPayload) => {

  const isUserExist = await User.findById(user.id).populate<{customer:ICustomer}>('customer').populate<{vendor:IVendor}>('vendor').lean();

  if(!isUserExist){ 
    throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist!");
  }

  if(user.role === USER_ROLES.CUSTOMER){

    await Customer.findByIdAndUpdate(isUserExist.customer?._id, { $set: { receivePhoneNotifications: !isUserExist.customer?.receivePhoneNotifications } }, { new: true });

  }

  if(user.role === USER_ROLES.VENDOR){

    await Vendor.findByIdAndUpdate(isUserExist.vendor?._id, { $set: { receivePhoneNotifications: !isUserExist.vendor?.receivePhoneNotifications } }, { new: true });

  }

  return `User permission toggled to ${isUserExist.status}`

}

export const AuthService = {
  verifyEmailToDB,
  loginUserFromDB,
  forgetPasswordToDB,
  resetPasswordToDB,
  changePasswordToDB,
  refreshToken,
  resendOtp,
  sendOtpToPhone,
  verifyOtpForPhone,
  deleteAccount,
  updateUserAppId,
  socialLogin,
  restrictOrActivateUser,
  toggleUserPermission
};
