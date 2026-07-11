ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_upload_lease_state_check" CHECK ((
        "import_jobs"."state" = 'uploading'
        and "import_jobs"."upload_attempt_id" is not null
        and "import_jobs"."upload_lease_expires_at" is not null
      ) or (
        "import_jobs"."state" <> 'uploading'
        and "import_jobs"."upload_lease_expires_at" is null
      ));