const generateOTP = (length = 6) => {
  const digits = "0123456789";
  let otp = "";

  for (let i = 0; i < length; i++) {
    otp += digits[Math.floor(Math.random() * 10)];
  }

  return otp;
};

const calculateOTPExpiry = (minutes = 10) => {
  const expiry = new Date();
  expiry.setMinutes(expiry.getMinutes() + minutes);
  return expiry;
};

const verifyOTP = (storedOTP, expiryTime, providedOTP) => {
  const now = new Date();

  if (now > expiryTime) {
    return false;
  }

  return storedOTP === providedOTP;
};

export { generateOTP, calculateOTPExpiry, verifyOTP };
