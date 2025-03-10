import express, { NextFunction, Request, Response } from 'express';
import auth from '../../middlewares/auth';
import { USER_ROLES } from '../../../enums/user';
import fileUploadHandler from '../../middlewares/fileUploadHandler';
import { MessageValidation } from './message.validation';
import { MessageController } from './message.controller';

const router = express.Router();

router.post(
  '/send-message',
  auth(USER_ROLES.CUSTOMER, USER_ROLES.VENDOR),
  fileUploadHandler(),
  (req: Request, res: Response, next: NextFunction) => {
    if (req.body.data) {
      req.body = MessageValidation.sendMessageValidationSchema.parse(
        JSON.parse(req.body.data)
      );
    }
    return MessageController.sendMessage(req, res, next);
  }
);
router.get(
  '/:chatId',
  auth(USER_ROLES.CUSTOMER, USER_ROLES.VENDOR),
  MessageController.getMessagesByChatId
);
export const MessageRoutes = router;
