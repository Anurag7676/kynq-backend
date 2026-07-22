export const verifyMlmApiKey = (req, res, next) => {
  const expectedKey = process.env.MLM_WEBHOOK_API_KEY;

  if (!expectedKey) {
    console.error("MLM_WEBHOOK_API_KEY is not configured");
    return res.status(500).json({
      success: false,
      message: "Webhook authentication is not configured",
    });
  }

  const providedKey =
    req.headers["x-api-key"] ||
    req.headers["x-api_key"] ||
    req.query.api_key ||
    req.query.apiKey;

  if (!providedKey || providedKey !== expectedKey) {
    return res.status(401).json({
      success: false,
      message: "Invalid or missing API key",
    });
  }

  return next();
};

