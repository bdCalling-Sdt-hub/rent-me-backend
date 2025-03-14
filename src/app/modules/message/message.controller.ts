import { Request, Response } from 'express';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';
import { StatusCodes } from 'http-status-codes';
import { MessageService } from './message.service';
import { paginationFields } from '../../../types/pagination';
import pick from '../../../shared/pick';
import { S3Helper } from '../../../helpers/s3Helper';

const sendMessage = catchAsync(async (req: Request, res: Response) => {
  const user = req.user;
  const { ...messageData } = req.body;


  const image: string[] = [];
  if (req.files && "image" in req.files && Array.isArray(req.files.image)) {
    image.push(...(await S3Helper.uploadMultipleFilesToS3(req.files.image, "uploads")));
  }

  messageData.image = image;

  const result = await MessageService.sendMessage(user, messageData);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Message sent successfully',
    data: result,
  });
});

const getMessagesByChatId = catchAsync(async (req: Request, res: Response) => {
  const { chatId } = req.params;
  const paginationOptions = pick(req.query, paginationFields);
  const result = await MessageService.getMessagesByChatId(
    chatId,
    paginationOptions
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Messages retrieved successfully',
    data: result,
  });
});

export const MessageController = {
  sendMessage,
  getMessagesByChatId,
};
