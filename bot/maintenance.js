// Deploy as a SEPARATE PRIVATE Cloud Function; entry point maintenance.handler.
// An IAM-authorized timer runs it hourly. Never expose this handler via HTTP.
const store = require('./src/store');
module.exports.handler = async function() {
  try {
    const result = await store.cleanupExpiredSessions();
    return {ok:true,removedSessions:result.removed};
  } catch {
    console.error('[maintenance] SESSION_CLEANUP_FAILED');
    throw new Error('SESSION_CLEANUP_FAILED');
  }
};
