import express from 'express';
import { USER_ROLES } from '../../../enums/user';
import auth from '../../middlewares/auth';
import validateRequest from '../../middlewares/validateRequest';
import { UserController } from './user.controller';
import { UserValidation } from './user.validation';
const router = express.Router();

//create and update user profile
router.post('/',
  validateRequest(UserValidation.createUserZodSchema),
  UserController.createUser
);

//get user profile
router.get(
  '/profile/:id',
  auth(USER_ROLES.ADMIN),
  UserController.getUserProfile
);



//update user
router.patch(
  '/:id',
  auth(USER_ROLES.ADMIN),
  validateRequest(UserValidation.updateUserZodSchema),
  UserController.updateUser
);

router.patch(
  '/manage-user/:id',
  auth(USER_ROLES.ADMIN),
  UserController.restrictOrActivateUser
);

//get all user
router.get('/', auth(USER_ROLES.ADMIN), UserController.getAllUser);

export const UserRoutes = router;
