function success(res, data = {}, status = 200) {
  return res.status(status).json({
    success: true,
    ...data
  });
}

function failure(res, status, message, details = undefined) {
  const body = {
    success: false,
    error: message
  };

  if (details !== undefined && process.env.NODE_ENV !== "production") {
    body.details = details;
  }

  return res.status(status).json(body);
}

module.exports = { success, failure };
