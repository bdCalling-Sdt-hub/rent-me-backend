import Stripe from 'stripe';
import config from '../../../config';

export const stripe = new Stripe(config.stripe_secret!, {
  apiVersion: '2024-11-20.acacia',
});

class StripeService {
  // Create a connected account for the vendor
  async createConnectedAccount(email: string): Promise<Stripe.Account> {
    const account = await stripe.accounts.create({
      type: 'express', // Choose 'express' or 'custom' based on your needs
      email,
      capabilities: {
        transfers: { requested: true },
        card_payments: { requested: true },
      },
    });
    return account;
  }

  // Generate the account onboarding link for the vendor
  async createAccountLink(
    accountId: string,
    returnUrl: string,
    refreshUrl: string
  ): Promise<string> {
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding',
    });
    return accountLink.url;
  }

  // Create a checkout session for the customer payment
  async createCheckoutSession(
    customerEmail: string,
    amount: number,
    orderId: string
  ) {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Service Payment',
              description: 'Payment for vendor service',
            },
            unit_amount: amount * 100, // Amount in cents
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url:
        'https://yourapp.com/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://yourapp.com/cancel',
      payment_intent_data: {},
      metadata: {
        customer_email: customerEmail,
        amount: amount.toString(),
        orderId: orderId,
      },
    });

    return { sessionId: session.id, url: session.url as string };
  }
}

export default new StripeService();