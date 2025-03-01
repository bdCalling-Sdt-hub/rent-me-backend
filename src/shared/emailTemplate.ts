import { ICreateAccount, IResetPassword } from '../types/emailTamplate';

const emailStyles = `
  body {
    font-family: Arial, sans-serif;
    background-color: #f9f9f9;
    padding: 20px;
    color: #333;
    text-align: center;
  }
  .container {
    width: 100%;
    max-width: 600px;
    margin: 0 auto;
    padding: 30px;
    background-color: #ffffff;
    border-radius: 10px;
    box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
  }
  .logo {
    display: block;
    margin: 0 auto 20px;
    width: 150px;
  }
  .heading {
    color: #FFD900;
    font-size: 22px;
    font-weight: bold;
    margin-bottom: 10px;
  }
  .content {
    font-size: 16px;
    line-height: 1.6;
    color: #555;
    margin-bottom: 20px;
  }
  .otp-box {
    background-color: #FFD900;
    width: 180px;
    padding: 12px;
    text-align: center;
    border-radius: 8px;
    color: #333;
    font-size: 26px;
    font-weight: bold;
    letter-spacing: 3px;
    margin: 20px auto;
  }
  .footer {
    font-size: 14px;
    color: #777;
    margin-top: 20px;
  }
`;

const createAccount = (values: ICreateAccount) => {
  return {
    to: values.email,
    subject: 'Welcome to Rent-Me! Verify Your Account',
    html: `<html>
      <head>
        <style>${emailStyles}</style>
      </head>
      <body>
        <div class="container">
          <img src="https://ibb.co.com/Brm4px4" alt="Rent-Me Logo" class="logo" />
          <h2 class="heading">Hey ${values.name}, Welcome to Rent-Me!</h2>
          <p class="content">
            Thank you for joining Rent-Me! To complete your registration, please verify your email address by using the one-time code below:
          </p>
          <div class="otp-box">${values.otp}</div>
          <p class="content">
            This code is valid for <strong>5 minutes</strong>. Please enter it in the app to verify your account.
          </p>
          <p class="footer">
            If you didn't sign up for Rent-Me, please ignore this email or contact support.
          </p>
        </div>
      </body>
    </html>`,
  };
};

const resetPassword = (values: IResetPassword) => {
  return {
    to: values.email,
    subject: 'Reset Your Password - Rent-Me',
    html: `<html>
      <head>
        <style>${emailStyles}</style>
      </head>
      <body>
        <div class="container">
          <img src="https://ibb.co.com/Brm4px4" alt="Rent-Me Logo" class="logo" />
          <h2 class="heading">Password Reset Request</h2>
          <p class="content">
            We received a request to reset your Rent-Me account password. Use the following one-time code to proceed:
          </p>
          <div class="otp-box">${values.otp}</div>
          <p class="content">
            This code is valid for <strong>5 minutes</strong>. If you did not request a password reset, please ignore this email.
          </p>
          <p class="footer">
            Need help? <a href="mailto:support@rentmeus.com" style="color: #FFD900; text-decoration: none;">Contact our support team</a>.
          </p>
        </div>
      </body>
    </html>`,
  };
};

export const emailTemplate = {
  createAccount,
  resetPassword,
};
