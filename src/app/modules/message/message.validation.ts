import { z } from 'zod';

const sendMessageValidationSchema = z.object({
  message: z.string().min(1, 'Message is required').optional(),
  isRead: z.boolean().default(false),
  chatId: z.string().min(24, 'chatId must be a valid ObjectId'),
  image: z.string().optional(),
});

export const MessageValidation = {
  sendMessageValidationSchema,
};
