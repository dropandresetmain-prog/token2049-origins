-- PostgreSQL TRUNCATE does not fire row update/delete triggers. Protect the immutable journal
-- from accidental bulk deletion as well; schema ownership/administration remains privileged.
CREATE TRIGGER journal_entries_no_truncate BEFORE TRUNCATE ON journal_entries
FOR EACH STATEMENT EXECUTE FUNCTION reject_journal_mutation();
CREATE TRIGGER journal_lines_no_truncate BEFORE TRUNCATE ON journal_lines
FOR EACH STATEMENT EXECUTE FUNCTION reject_journal_mutation();
