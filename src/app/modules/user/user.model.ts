import bcrypt from 'bcrypt';

import { model, Schema, Types } from 'mongoose';
import config from '../../../config';
import { USER_ROLES } from '../../../enums/user';

import { IUser, UserModel } from './user.interface';
import { StatusCodes } from 'http-status-codes';
import ApiError from '../../../errors/ApiError';
const userSchema = new Schema<IUser, UserModel>(
  {
    id: {
      type: String,
      required: true,
      unique: true,
    },
    email: {
      type: String,
      lowercase: true,
    },
    password: {
      type: String,
      select: 0,
      minlength: 8,
    },
    role: {
      type: String,
      enum: Object.values(USER_ROLES),
      required: true,
    },
    customer: {
      type: Types.ObjectId,
      ref: 'Customer',
    },
    vendor: {
      type: Types.ObjectId,
      ref: 'Vendor',
    },
    admin: {
      type: Types.ObjectId,
      ref: 'Admin',
    },
    status: {
      type: String,
      enum: ['active', 'restricted', 'delete'],
      default: 'active',
    },
    appId: {
      type: String,
      select: 0,
    },
    verified: {
      type: Boolean,
      default: false,
    },
    wrongLoginAttempts: {
      type: Number,
      default: 0,
    },
    restrictionLeftAt: {
      type: Date,
      default: null,
    },
    authentication: {
      type: {
        passwordChangedAt: {
          type: Date,
        },
        isResetPassword: {
          type: Boolean,
          default: false,
        },
        oneTimeCode: {
          type: Number,
          default: null,
        },
        expireAt: {
          type: Date,
          default: null,
        },
      },
      select: 0,
    },
  },
  {
    timestamps: true,
  }
);

//exist user check
userSchema.statics.isExistUserById = async (id: string) => {
  const isExist = await User.findById(id);
  return isExist;
};

userSchema.statics.isExistUserByEmail = async (email: string) => {
  const isExist = await User.findOne({
    email,
    status: { $in: ['active', 'restricted'] },
  });
  return isExist;
};

//is match password
userSchema.statics.isMatchPassword = async (
  password: string,
  hashPassword: string
): Promise<boolean> => {
  return await bcrypt.compare(password, hashPassword);
};

userSchema.statics.getUserId = async (id: Types.ObjectId, role: string):Promise<Types.ObjectId> => {
  const query = role === 'customer' ? { customer: id } : role === 'vendor' ? { vendor: id } : { admin: id };
  const user = await User.findOne(query).select('_id');
  if(!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');
  }
  return user?._id;
}
//check user
userSchema.pre('save', async function (next) {


  //password hash
  this.password = await bcrypt.hash(
    this.password,
    Number(config.bcrypt_salt_rounds)
  );
  next();
});

userSchema.index({ email: 1, status: 1 });
userSchema.index({ vendor: 1 });
userSchema.index({ customer: 1 });

export const User = model<IUser, UserModel>('User', userSchema);
