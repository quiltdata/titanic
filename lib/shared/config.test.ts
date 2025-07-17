import { Config, S3Config } from './config';

describe('Config', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env = {};
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Config constructor with bucket name inputs', () => {
    it('should load configuration from provided bucket name values', () => {
      const config = Config.createTestInstance({
        glueTablesBucketName: 'glue-bucket',
        s3TablesBucketName: 's3-bucket',
        aws_region: 'us-west-2',
        awsAccountId: '123456789012',
        athenaDatabaseName: 'glue_db',
        s3TableDatabaseName: 's3_db',
      });

      expect(config.glueTablesBucketName).toBe('glue-bucket');
      expect(config.s3TablesBucketName).toBe('s3-bucket');
      expect(config.getGlueTablesBucketName()).toBe('glue-bucket');
      expect(config.getS3TablesBucketName()).toBe('s3-bucket');
      expect(config.getGlueTablesBucketArn()).toBe('arn:aws:s3:::glue-bucket');
      expect(config.getS3TablesBucketArn()).toBe('arn:aws:s3tables:us-west-2:123456789012:bucket/s3-bucket');
      expect(config.aws_region).toBe('us-west-2');
      expect(config.athenaDatabaseName).toBe('glue_db');
      expect(config.s3TableDatabaseName).toBe('s3_db');
    });

    it('should default to empty strings when no values provided', () => {
      const config = Config.createTestInstance();

      expect(config.glueTablesBucketName).toBe('');
      expect(config.s3TablesBucketName).toBe('');
    });

    it('should correctly interpret environment variables', () => {
      process.env.GLUE_TABLES_BUCKET_NAME = 'env-glue-bucket';
      process.env.S3_TABLES_BUCKET_NAME = 'env-s3-bucket';
      process.env.CDK_DEFAULT_REGION = 'env-region';
      process.env.AWS_ACCOUNT_ID = '123456789012';
      process.env.ATHENA_DATABASE_NAME = 'env-glue-db';
      process.env.S3TABLE_DATABASE_NAME = 'env-s3-db';

      const config = Config.create();

      expect(config.glueTablesBucketName).toBe('env-glue-bucket');
      expect(config.s3TablesBucketName).toBe('env-s3-bucket');
      expect(config.getGlueTablesBucketName()).toBe('env-glue-bucket');
      expect(config.getS3TablesBucketName()).toBe('env-s3-bucket');
    });
  });

  describe('ARN parsing utilities', () => {
    it('should extract bucket name from S3 bucket ARN', () => {
      const arn = 'arn:aws:s3:::my-bucket-name';
      expect(Config.extractBucketNameFromArn(arn)).toBe('my-bucket-name');
    });

    it('should extract bucket name from S3 Tables ARN', () => {
      const arn = 'arn:aws:s3tables:us-east-1:123456789012:bucket/my-s3tables-bucket';
      expect(Config.extractBucketNameFromArn(arn)).toBe('my-s3tables-bucket');
    });

    it('should handle non-ARN strings (pass through)', () => {
      const bucketName = 'regular-bucket-name';
      expect(Config.extractBucketNameFromArn(bucketName)).toBe('regular-bucket-name');
    });
  });

  describe('Glue Config', () => {
    it('should provide correct bucket methods for Glue mode', () => {
      const config = Config.createTestInstance({
        glueTablesBucketName: 'glue-bucket',
        s3TablesBucketName: 's3-bucket',
        aws_region: 'us-west-2',
        awsAccountId: '123456789012',
      });

      // Glue config uses Glue bucket for both tables and results
      expect(config.getTargetBucket()).toBe('glue-bucket');
      expect(config.getResultsBucket()).toBe('glue-bucket');
      
      // Should provide ARNs when requested
      expect(config.getGlueTablesBucketArn()).toBe('arn:aws:s3:::glue-bucket');
      expect(config.getS3TablesBucketArn()).toBe('arn:aws:s3tables:us-west-2:123456789012:bucket/s3-bucket');
      
      // Should provide bucket names when requested
      expect(config.getGlueTablesBucketName()).toBe('glue-bucket');
      expect(config.getS3TablesBucketName()).toBe('s3-bucket');
    });

    it('should use Glue database for read and write operations', () => {
      const config = Config.createTestInstance({
        athenaDatabaseName: 'my-glue-db',
        s3TableDatabaseName: 'my-s3-db'
      });

      expect(config.getReadDatabaseName()).toBe('my-glue-db');
      expect(config.getWriteDatabaseName()).toBe('my-glue-db');
    });

    it('should provide database-only execution context', () => {
      const config = Config.createTestInstance({
        athenaDatabaseName: 'test-db'
      });

      const context = config.getExecutionContext();
      expect(context).toEqual({ Database: 'test-db' });
      expect(context).not.toHaveProperty('Catalog');
    });
  });

  describe('S3Config', () => {
    it('should provide correct bucket methods for S3 Tables mode', () => {
      const config = new S3Config({
        glueTablesBucketName: 'glue-bucket',
        s3TablesBucketName: 's3-bucket',
        aws_region: 'us-west-2',
        awsAccountId: '123456789012',
        s3TableDatabaseName: 'quilt_titanic'
      });

      // S3Config uses S3 Tables bucket for tables, Glue bucket for results
      expect(config.getTargetBucket()).toBe('s3-bucket');
      expect(config.getResultsBucket()).toBe('glue-bucket');
    });

    it('should use different databases for read vs write operations', () => {
      const config = new S3Config({
        athenaDatabaseName: 'source-db',
        s3TableDatabaseName: 'target-db'
      });

      expect(config.getReadDatabaseName()).toBe('source-db');
      expect(config.getWriteDatabaseName()).toBe('target-db');
    });

    it('should format S3 Tables catalog name correctly', () => {
      const config = new S3Config({
        s3TablesBucketName: 'my-s3tables-bucket'
      });

      expect(config.getS3TableCatalogName()).toBe('s3tablescatalog/my-s3tables-bucket');
    });

    it('should provide catalog and database execution context', () => {
      const config = new S3Config({
        s3TablesBucketName: 'my-s3tables-bucket',
        s3TableDatabaseName: 'quilt_titanic'
      });

      const context = config.getExecutionContext();
      expect(context.Catalog).toBe('s3tablescatalog/my-s3tables-bucket');
      expect(context.Database).toBe('quilt_titanic');
    });
  });

  describe('Config factory method', () => {
    it('should create Config instance when USE_S3_TABLE=false', () => {
      process.env.USE_S3_TABLE = 'false';
      const config = Config.create();
      expect(config.constructor.name).toBe('Config');
      expect(config.useS3Table).toBe(false);
    });

    it('should create S3Config instance when USE_S3_TABLE=true', () => {
      process.env.USE_S3_TABLE = 'true';
      const config = Config.create();
      expect(config.constructor.name).toBe('S3Config');
      expect(config.useS3Table).toBe(true);
    });

    it('should default to Config when USE_S3_TABLE not set', () => {
      delete process.env.USE_S3_TABLE;
      const config = Config.create();
      expect(config.constructor.name).toBe('Config');
      expect(config.useS3Table).toBe(false);
    });
  });

  describe('Table name utilities', () => {
    it('should extract source bucket from table names', () => {
      expect(Config.sourceBucketFromTableName('quilt-bake_packages-view')).toBe('quilt-bake');
      expect(Config.sourceBucketFromTableName('test-bucket_objects-view')).toBe('test-bucket');
      expect(Config.sourceBucketFromTableName('my-registry_packages-view')).toBe('my-registry');
    });
  });
});
