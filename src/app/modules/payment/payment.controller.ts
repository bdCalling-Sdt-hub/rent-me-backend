import { calculateProfileCompletion } from '../vendor/vendor.utils';
import { Request, Response } from 'express';
import catchAsync from '../../../shared/catchAsync';
import { StatusCodes } from 'http-status-codes';
import sendResponse from '../../../shared/sendResponse';
import { PaymentService } from './payment.service';
import Stripe from 'stripe';
import config from '../../../config';
import { Payment } from './payment.model';
import { stripe } from './payment.stripe';
import { Order } from '../order/order.model';
import { logger } from '../../../shared/logger';
import ApiError from '../../../errors/ApiError';
import { Vendor } from '../vendor/vendor.model';
import { USER_ROLES } from '../../../enums/user';
import { IVendor } from '../vendor/vendor.interface';
import { orderNotificationAndDataSendWithSocket } from '../order/order.utils';

const onboardVendor = catchAsync(async (req: Request, res: Response) => {
  const user = req.user;

  const result = await PaymentService.onboardVendor(user);
  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Vendor onboarded link fetched successfully',
    data: result,
  });
});

const createCheckoutSession = catchAsync(
  async (req: Request, res: Response) => {
    const user = req.user;
    const { orderId } = req.params;

    const result = await PaymentService.createCheckoutSession(user, orderId);
    sendResponse(res, {
      success: true,
      statusCode: StatusCodes.OK,
      message: 'Payment intent created successfully',
      data: result,
    });
  }
);

const transferToVendor = catchAsync(async (req: Request, res: Response) => {
  const { orderId } = req.params;
  const user = req.user;

  const result = await PaymentService.transferToVendor(user, orderId);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Money transferred to vendor account successful.',
    data: result,
  });
});

const addFundToAccount = catchAsync(async (req: Request, res: Response) => {
  // Create a test charge to simulate funds
  const charge = await stripe.charges.create({
    amount: 90000000, // Amount in cents, i.e.
    currency: 'usd',
    source: 'tok_visa', // Test card token
    description: 'Test charge to add funds to platform balance',
  });

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Money transferred to vendor account successful.',
    data: charge,
  });
});

const getConnectedUserDashboard = catchAsync(
  async (req: Request, res: Response) => {
    const user = req.user;

    const result = await PaymentService.getConnectedUserDashboard(user);
    sendResponse(res, {
      success: true,
      statusCode: StatusCodes.OK,
      message: 'Vendor dashboard retrieved successfully',
      data: result,
    });
  }
);

const webhooks = catchAsync(async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'] as string;
  const endpointSecret = config.webhook_secret!; // Your webhook secret
  let event: Stripe.Event;

  // Verify the webhook signature
  try {
    event = Stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    logger.error(`Webhook signature verification failed: ${errorMessage}`); // Add detailed logging
    return res.status(400).send(`Webhook error: ${errorMessage}`);
  }

  // Handle the event
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;

        // Update the Payment status and related Order status
        const payment = await Payment.findOneAndUpdate(
          {
            orderId: session?.metadata?.orderId,
            status: 'initiated',
            stripePaymentSessionId: session.id,
          },
          {
            $set: {
              status: 'succeeded',
              stripePaymentIntentId: session.payment_intent,
            },
          },
          { new: true }
        );

        if (!payment) {
          throw new ApiError(StatusCodes.BAD_REQUEST, 'Payment update failed');
        }

        const order = await Order.findOneAndUpdate(
          { _id: session?.metadata?.orderId, status: 'accepted' },
          { $set: { status: 'ongoing', paymentStatus: 'full' } },
          { new: true }
        ).populate<{vendorId:Partial<IVendor>}>({
          path: 'vendorId',
          select: {
            name:1,
            deviceId:1
          }
        });

        if (!order) {
          throw new ApiError(400, 'Order status update failed');
        }


        //TODO test this
         const notificationData = { title: `Payment received for order ${order.id} please proceed with the order`,
           message: `We have received the payment for order ${order.id} please proceed with the order, after completion you will receive the payment.`
         }
        await orderNotificationAndDataSendWithSocket('order', order?._id, USER_ROLES.VENDOR, notificationData)

        logger.info(
          `Payment and Order updated successfully for orderId: ${session.metadata?.orderId}`
        );

        break;
      }
      case 'payment_intent.canceled': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;

        const payment = await Payment.findOneAndUpdate(
          { orderId: paymentIntent.metadata.orderId },
          { $set: { status: 'canceled' } },
          { new: true }
        );

        if (!payment) {
          throw new ApiError(
            StatusCodes.BAD_REQUEST,
            'Payment status update failed for canceled payment'
          );
        }

        logger.info(
          `Payment canceled for orderId: ${paymentIntent.metadata.orderId}`
        );
        break;
      }

      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;

        const payment = await Payment.findOneAndUpdate(
          { orderId: paymentIntent.metadata.orderId },
          { $set: { status: 'failed' } },
          { new: true }
        );

        if (!payment) {
          throw new ApiError(
            StatusCodes.BAD_REQUEST,
            'Payment status update failed for failed payment'
          );
        }

        logger.info(
          `Payment failed for orderId: ${paymentIntent.metadata.orderId}`
        );
        break;
      }


      case 'account.external_account.created': {
        const createdAccount = event.data.object;
        const result = await Vendor.findOneAndUpdate(
          { stripeId: createdAccount.account },
          { $set: { stripeConnected: true } },
          { new: true }
        );

        const profileCompletion = calculateProfileCompletion(result!);

        await Vendor.findOneAndUpdate(
          { stripeId: createdAccount.account },
          {
            $set: {
              profileCompletion: profileCompletion,
              verifiedFlag: profileCompletion === 100,
            },
          },
          { new: true }
        );

        break;
      }

      case 'account.external_account.updated': {
        const updatedAccount = event.data.object;
        updatedAccount.available_payout_methods
        const result = await Vendor.findOneAndUpdate(
          { stripeId: updatedAccount.account },
          { $set: { stripeConnected: true } },
          { new: true }
        );

        const profileCompletion = calculateProfileCompletion(result!);

        await Vendor.findOneAndUpdate(
          { stripeId: updatedAccount.account },
          {
            $set: {
              profileCompletion: profileCompletion,
              verifiedFlag: profileCompletion === 100,
            },
          },
          { new: true }
        );

        break;
      }

      case 'payout.created': {
        const payout = event.data.object;
        logger.info(`Payout created: ${payout.id}`);
        break;
      }
      
      case 'payout.failed': {
        const payout = event.data.object;
        logger.info(`Payout failed: ${payout.id}`);
        break;
      }
      case 'payout.paid': {
        const payout = event.data.object;
        logger.info(`Payout paid: ${payout.id}`);
        break;
      }

      default:
        // Handle unexpected event types
        logger.warn(`Received unexpected event type: ${event.type}`);
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    logger.error(`Error handling event: ${errorMessage}`);
    return res.status(500).send(`Server error: ${errorMessage}`);
  }

  // Acknowledge receipt of the event
  res.status(200).send('Received');
});

export const PaymentController = {
  onboardVendor,
  createCheckoutSession,
  webhooks,
  transferToVendor,
  addFundToAccount,
  getConnectedUserDashboard,
};
