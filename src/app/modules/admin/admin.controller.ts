import { Request, Response } from 'express';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';
import { StatusCodes } from 'http-status-codes';
import { AdminService } from './admin.service';
import { S3Helper } from '../../../helpers/s3Helper';

const getAdminProfile = catchAsync(async (req: Request, res: Response) => {
  const admin = req.user;

  const result = await AdminService.getAdminProfile(admin);
  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Admin profile retrieved successfully',
    data: result,
  });
});

const deleteAdmin = catchAsync(async (req: Request, res: Response) => {
  const admin = req.user;
  const result = await AdminService.deleteAdmin(admin);
  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Admin deleted successfully',
    data: result,
  });
});

const updateAdminProfile = catchAsync(async (req: Request, res: Response) => {
  const admin = req.user;
  const payload = req.body;

  if (req.files && 'image' in req.files && req.files.image[0]) {
    payload.profileImg = await S3Helper.uploadToS3(req.files.image[0], 'applications');
  }

  const result = await AdminService.updateAdminProfileToDB(admin, payload);
  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Admin profile updated successfully',
    data: result,
  });
});

export const AdminController = {
  getAdminProfile,
  deleteAdmin,
  updateAdminProfile,
};
