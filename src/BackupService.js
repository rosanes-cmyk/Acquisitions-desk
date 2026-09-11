/**
 * BackupService.js - the daily database backup (4.12).
 *
 * Recovery must never depend on one spreadsheet staying healthy, so a copy goes
 * to Drive every day and every attempt - success or failure - is recorded.
 */

/** Keeps the first backup of each month forever; prunes the rest by age. */
function backupRetentionDays_() {
  return settingNumber_('backup_retention_days', 60);
}

function backupFolder_() {
  var folderId = getProp_(PROP_BACKUP_FOLDER_);
  if (folderId) return DriveApp.getFolderById(folderId);

  // G8 default: a folder of this name in the owner's Drive, created once.
  var name = 'THB Acquisitions Desk Backups';
  var existing = DriveApp.getFoldersByName(name);
  var folder = existing.hasNext() ? existing.next() : DriveApp.createFolder(name);
  setProp_(PROP_BACKUP_FOLDER_, folder.getId());
  return folder;
}

/**
 * GUARDED EDITOR-RUN ENTRY POINT (4.2.3), and the daily trigger's handler.
 *
 * When the time-driven trigger fires there is no active user, so the ADMIN guard
 * is applied only to a manual run. The trigger itself is installed by an admin
 * through installTriggers().
 */
function createDatabaseBackup() {
  var triggered = !activeUserEmail_();
  var ctx = triggered ? { user_id: 'SYSTEM_TRIGGER', email: '', name: 'Daily trigger' }
    : requireRole_(ROLE_ADMIN_);
  return runBackup_(ctx);
}

function runBackup_(ctx) {
  var nowIso = nowIsoUtc_();
  var backupId = newUniqueId_(ID_PREFIX_.BACKUP, compactStamp_(nowIso));
  var stamp = Utilities.formatDate(new Date(), businessTimezone_(), 'yyyy-MM-dd HHmm');
  var name = 'THB Acquisitions Desk Backup - ' + stamp;
  var kinds = columnKinds_(SHEET_NAMES_.BACKUP_LOG);

  try {
    var folder = backupFolder_();
    var copy = DriveApp.getFileById(getProp_(PROP_DB_ID_)).makeCopy(name, folder);

    appendRow_(SHEET_NAMES_.BACKUP_LOG, {
      backup_id: backupId, timestamp: nowIso, backup_file_id: copy.getId(),
      backup_name: name, status: 'SUCCESS', error: ''
    }, kinds);

    var pruned = pruneOldBackups_(folder);
    auditSafely_(ctx.user_id, ctx.email, 'BACKUP_CREATED', 'backup', copy.getId(),
      name + '; pruned ' + pruned);

    return { backup_id: backupId, backup_name: name, file_id: copy.getId(), pruned: pruned };
  } catch (err) {
    // A failed backup is recorded, not swallowed - a silent gap in the backup
    // history is worse than the failure itself.
    appendRow_(SHEET_NAMES_.BACKUP_LOG, {
      backup_id: backupId, timestamp: nowIso, backup_file_id: '', backup_name: name,
      status: 'FAILED', error: trimTo_(err && err.message ? err.message : err, 500)
    }, kinds);
    errorLog_(ctx.user_id, 'createDatabaseBackup', 'backup', backupId, err, '');
    throw err;
  }
}

/**
 * Deletes copies older than backup_retention_days, ALWAYS keeping the first
 * backup of each month (4.12). "Delete" here means a Drive copy, never a row in
 * the database - rule 1.6 is about records, and the log row stays.
 */
function pruneOldBackups_(folder) {
  var cutoff = addDays_(businessToday_(), -backupRetentionDays_());
  var files = folder.getFiles();
  var candidates = [];
  while (files.hasNext()) {
    var file = files.next();
    var name = file.getName();
    var match = /(\d{4}-\d{2}-\d{2})/.exec(name);
    if (!match || name.indexOf('THB Acquisitions Desk Backup') !== 0) continue;
    candidates.push({ file: file, date: match[1] });
  }

  var firstOfMonthKept = {};
  candidates.sort(function (a, b) { return compareIso_(a.date, b.date); });
  candidates.forEach(function (entry) {
    var month = entry.date.slice(0, 7);
    if (!firstOfMonthKept[month]) firstOfMonthKept[month] = entry.date;
  });

  var pruned = 0;
  candidates.forEach(function (entry) {
    if (compareIso_(entry.date, cutoff) >= 0) return;
    if (firstOfMonthKept[entry.date.slice(0, 7)] === entry.date) return;
    entry.file.setTrashed(true);
    pruned++;
  });
  return pruned;
}

function getBackups_(ctx, payload) {
  requireCapability_(ctx, 'viewBackups', 'see the backup log');
  var limit = Math.min(200, Math.max(1, toNumberOrNull_(payload && payload.limit) || 50));
  var rows = readAll_(SHEET_NAMES_.BACKUP_LOG);
  return rows.slice(-limit).reverse();
}

function runBackupNow_(ctx) {
  requireCapability_(ctx, 'runBackupNow', 'run a backup');
  return runBackup_(ctx);
}
