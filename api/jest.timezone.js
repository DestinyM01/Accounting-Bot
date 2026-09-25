// Jest global setup: every test runs in the user's zone, the same as the api image
// (ENV TZ in api/Dockerfile). Workers start after this and inherit it.
module.exports = async () => {
  process.env.TZ = 'America/Santo_Domingo';
};
