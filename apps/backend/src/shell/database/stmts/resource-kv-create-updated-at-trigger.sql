CREATE TRIGGER `resource_entries_updated_at_after_update`
AFTER UPDATE OF `value`, `revision` ON `resource_entries`
FOR EACH ROW
WHEN NEW.`updated_at` = OLD.`updated_at`
BEGIN
  UPDATE `resource_entries`
  SET `updated_at` = CASE
    WHEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') > OLD.`updated_at`
      THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    ELSE strftime('%Y-%m-%dT%H:%M:%fZ', OLD.`updated_at`, '+0.001 seconds')
  END
  WHERE `key` = OLD.`key`;
END
