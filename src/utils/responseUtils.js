// utils/responseUtils.js

/**
 * Standardized response function for API endpoints
 * @param {Object} res - Express response object
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Response message
 * @param {*} data - Response data (optional)
 */
export const sendResponse = (res, statusCode, message, data = null) => {
  const response = {
    success: statusCode >= 200 && statusCode < 300,
    message,
    ...(data && { data }),
  };

  return res.status(statusCode).json(response);
};

/**
 * Error response function
 * @param {Object} res - Express response object
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @param {*} error - Error details (optional)
 */
export const sendErrorResponse = (res, statusCode, message, error = null) => {
  const response = {
    success: false,
    message,
    ...(error && { error }),
  };

  return res.status(statusCode).json(response);
}; 