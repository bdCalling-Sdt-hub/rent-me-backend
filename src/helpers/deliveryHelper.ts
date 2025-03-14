import { StatusCodes } from 'http-status-codes';
import ApiError from '../errors/ApiError';
import { Order } from '../app/modules/order/order.model';
import { calculateDistance } from '../app/modules/order/order.utils';


const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const stopDelivery = async (
  orderId: string,
  longitude: number,
  latitude: number
) => {
  const order = await Order.findById(orderId);
  if (!order) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Order not found');
  }
  const { deliveryLocation } = order;

  const distance = calculateDistance(
    [deliveryLocation.coordinates[0], deliveryLocation.coordinates[1]],
    [longitude, latitude]
  );

  if (distance < 0.03) {
    await delay(180000); // Wait for 3 minutes (180,000 ms)

    const updatedOrder = await Order.findByIdAndUpdate(
      orderId,
      { $set: { status: 'ongoing' } },
      { new: true } // Returns the updated document
    );

    if (!updatedOrder) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        'Failed to update order status'
      );
    }

    //@ts-expect-error socket
    global.io.emit(`deliveryStopped::${orderId}`, updatedOrder.toObject()); // Emit plain JSON object
    return updatedOrder; // Return the updated order
  }

  return null; // Return null if distance condition isn't met
};
