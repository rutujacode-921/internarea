const User = require("../Model/User");

// Finds the signed-in user's record, creating it on first use.
async function getOrCreateUser(authUser) {
  return User.findOneAndUpdate(
    { uid: authUser.uid },
    {
      $set: { email: authUser.email, name: authUser.name },
      $setOnInsert: { uid: authUser.uid },
    },
    { upsert: true, new: true }
  );
}

module.exports = { getOrCreateUser };

const premiumInfo = (user) => ({
  active: Boolean(user?.premiumUntil && user.premiumUntil > new Date()),
  until: user?.premiumUntil || null,
});

module.exports.premiumInfo = premiumInfo;
