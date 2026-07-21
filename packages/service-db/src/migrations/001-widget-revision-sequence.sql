ALTER TABLE widget_definitions
  ADD COLUMN next_revision_number INTEGER NOT NULL DEFAULT 1
  CHECK (next_revision_number >= 1);

UPDATE widget_definitions
SET next_revision_number = COALESCE(
  (
    SELECT MAX(revision.revision_number) + 1
    FROM widget_definition_revisions AS revision
    WHERE revision.org_id = widget_definitions.org_id
      AND revision.definition_id = widget_definitions.id
  ),
  1
);
