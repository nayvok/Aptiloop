-- Published source revisions allow only the explicit published-to-archived
-- transition. Archival and update timestamps are immutable otherwise.
DROP TRIGGER curriculum_versions_published_update_guard;
CREATE TRIGGER curriculum_versions_published_update_guard
BEFORE UPDATE ON curriculum_versions
WHEN OLD.status != 'draft' AND (
  NEW.curriculum_id IS NOT OLD.curriculum_id OR
  NEW.revision IS NOT OLD.revision OR
  NEW.parent_version_id IS NOT OLD.parent_version_id OR
  NEW.title IS NOT OLD.title OR
  NEW.description IS NOT OLD.description OR
  NEW.content_hash IS NOT OLD.content_hash OR
  NEW.created_at IS NOT OLD.created_at OR
  NEW.published_at IS NOT OLD.published_at OR
  (NEW.status = OLD.status AND (
    NEW.archived_at IS NOT OLD.archived_at OR
    NEW.updated_at IS NOT OLD.updated_at
  )) OR
  NOT (
    NEW.status = OLD.status OR
    (OLD.status = 'published' AND NEW.status = 'archived')
  )
)
BEGIN SELECT RAISE(ABORT, 'published curriculum version is immutable'); END;

-- Quarantined revision source rows have no accepted Course projection whose
-- immutability guards could protect their m2-v1 provenance hash. Freeze those
-- source rows directly, including invalid draft-like legacy states.
CREATE TRIGGER curriculum_versions_quarantined_update_guard
BEFORE UPDATE ON curriculum_versions
WHEN EXISTS (
  SELECT 1 FROM migration_provenance provenance
  WHERE provenance.transform_version = 'm2-v1'
    AND provenance.source_table = 'curriculum_versions'
    AND provenance.source_primary_key = OLD.id
    AND provenance.status = 'quarantined'
)
BEGIN SELECT RAISE(ABORT, 'quarantined curriculum version is immutable'); END;
CREATE TRIGGER curriculum_versions_quarantined_delete_guard
BEFORE DELETE ON curriculum_versions
WHEN EXISTS (
  SELECT 1 FROM migration_provenance provenance
  WHERE provenance.transform_version = 'm2-v1'
    AND provenance.source_table = 'curriculum_versions'
    AND provenance.source_primary_key = OLD.id
    AND provenance.status = 'quarantined'
)
BEGIN SELECT RAISE(ABORT, 'quarantined curriculum version is immutable'); END;
