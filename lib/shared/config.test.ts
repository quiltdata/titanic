import { Config, S3Config } from './config';

describe('Config', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env = {};
  });

  afterEach(() => {
    process.env = originalEnv;
    // Use reflection to reset the private singleton instance for isolation
    (Config as any)._instance = null;
  });

  it('should load configuration from provided values', () => {
    const config = Config.createTestInstance({
      glueTablesBucket: 'glue-bucket',
      s3TablesBucket: 's3-bucket',
      aws_region: 'us-west-2',
      glueDatabaseName: 'glue_db',
      s3TableDatabaseName: 's3_db',
    });

    expect(config.glueTablesBucket).toBe('glue-bucket');
    expect(config.s3TablesBucket).toBe('s3-bucket');
    expect(config.aws_region).toBe('us-west-2');
    expect(config.glueDatabaseName).toBe('glue_db');
    expect(config.s3TableDatabaseName).toBe('s3_db');
  });

  it('should handle missing values gracefully', () => {
    const config = Config.createTestInstance({});

    expect(config.glueTablesBucket).toBe('');
    expect(config.s3TablesBucket).toBe('');
    expect(config.aws_region).toBe('us-east-1');
    expect(config.glueDatabaseName).toBe('glue_database');
    expect(config.s3TableDatabaseName).toBe('s3_table_database');
  });

  it('should correctly interpret environment variables', () => {
    process.env.GLUE_TABLES_BUCKET = 'env-glue-bucket';
    process.env.S3_TABLES_BUCKET = 'env-s3-bucket';
    process.env.AWS_REGION = 'env-region';
    process.env.GLUE_DATABASE_NAME = 'env-glue-db';
    process.env.S3TABLE_DATABASE_NAME = 'env-s3-db';

    const config = Config.create();

    expect(config.glueTablesBucket).toBe('env-glue-bucket');
    expect(config.s3TablesBucket).toBe('env-s3-bucket');
    expect(config.aws_region).toBe('env-region');
    expect(config.glueDatabaseName).toBe('env-glue-db');
    expect(config.s3TableDatabaseName).toBe('env-s3-db');
  });

  it('should return correct database names for Glue config', () => {
    const config = Config.createTestInstance({
      glueDatabaseName: 'glue_db',
      s3TableDatabaseName: 's3_db',
    });

    expect(config.getReadDatabaseName()).toBe('glue_db');
    expect(config.getWriteDatabaseName()).toBe('glue_db');
    expect(config.getTablesBucket()).toBe('');
  });

  it('should return correct tables bucket for Glue config', () => {
    const config = Config.createTestInstance({
      glueTablesBucket: 'glue-bucket',
      s3TablesBucket: 's3-bucket',
    });

    expect(config.getResultsBucket()).toBe('glue-bucket');
    expect(config.getTablesBucket()).toBe('glue-bucket');
  });

  it('should return correct execution context for Glue config', () => {
    const config = Config.createTestInstance({
      glueDatabaseName: 'test_glue_db',
    });

    const context = config.getExecutionContext();
    expect(context).toEqual({ Database: 'test_glue_db' });
  });
});

describe('S3Config', () => {
  it('should override methods for S3 behavior', () => {
    const config = S3Config.createTestInstance({
      glueDatabaseName: 'glue_db',
      s3TableDatabaseName: 's3_db',
      glueTablesBucket: 'glue-bucket',
      s3TablesBucket: 's3-bucket',
    });

    expect(config.getReadDatabaseName()).toBe('glue_db');
    expect(config.getWriteDatabaseName()).toBe('s3_db');
    expect(config.getTablesBucket()).toBe('s3-bucket');
  });

  it('should return correct S3 table catalog name', () => {
    const config = S3Config.createTestInstance({
      s3TablesBucket: 'my-s3-bucket',
    });

    expect(config.getS3TableCatalogName()).toBe('my-s3-bucket');
  });

  it('should return correct execution context for S3 config', () => {
    const config = S3Config.createTestInstance({
      s3TableDatabaseName: 'test_s3_db',
      s3TablesBucket: 'my-s3-bucket',
    });

    const context = config.getExecutionContext();
    expect(context).toEqual({
      Catalog: 'my-s3-bucket',
      Database: 'test_s3_db'
    });
  });

  it('should create correct table queries', () => {
    const config = S3Config.createTestInstance({
      s3TableDatabaseName: 's3_db',
      s3TablesBucket: 's3-bucket',
    });

    const createQuery = config.createTableQuery('test_table', 'id int, name string');
    expect(createQuery).toContain('CREATE TABLE test_table');
    expect(createQuery).toContain("LOCATION 's3://s3-bucket/test_table/'");

    // S3Config inherits dropTableQuery from Config (no override)
    const dropQuery = config.dropTableQuery('test_table');
    expect(dropQuery).toBe('DROP TABLE IF EXISTS test_table');
  });

  it('should test all Config methods', () => {
    const config = Config.createTestInstance({
      glueDatabaseName: 'test_glue_db',
      glueTablesBucket: 'test-glue-bucket',
      s3TableDatabaseName: 'test_s3_db',
      s3TablesBucket: 'test-s3-bucket',
      aws_region: 'us-west-1'
    });

    // Test all getter methods
    expect(config.getReadDatabaseName()).toBe('test_glue_db');
    expect(config.getWriteDatabaseName()).toBe('test_glue_db');
    expect(config.getResultsBucket()).toBe('test-glue-bucket');
    expect(config.getTablesBucket()).toBe('test-glue-bucket');

    // Test SQL generation
    const createQuery = config.createTableQuery('my_table', 'col1 STRING, col2 INT');
    expect(createQuery).toContain('CREATE TABLE my_table');
    expect(createQuery).toContain('col1 STRING, col2 INT');
    expect(createQuery).toContain("WITH (format = 'iceberg')");

    const dropQuery = config.dropTableQuery('my_table');
    expect(dropQuery).toBe('DROP TABLE IF EXISTS my_table');

    // Test properties
    expect(config.aws_region).toBe('us-west-1');
    expect(config.glueDatabaseName).toBe('test_glue_db');
    expect(config.glueTablesBucket).toBe('test-glue-bucket');
    expect(config.s3TableDatabaseName).toBe('test_s3_db');
    expect(config.s3TablesBucket).toBe('test-s3-bucket');
    expect(config.useS3Table).toBe(false);

    // Test execution context
    const context = config.getExecutionContext();
    expect(context).toEqual({ Database: 'test_glue_db' });
  });

  it('should test all S3Config methods', () => {
    const config = S3Config.createTestInstance({
      glueDatabaseName: 'test_glue_db',
      glueTablesBucket: 'test-glue-bucket',
      s3TableDatabaseName: 'test_s3_db',
      s3TablesBucket: 'test-s3-bucket',
      aws_region: 'us-west-1'
    });

    // Test overridden getter methods
    expect(config.getReadDatabaseName()).toBe('test_glue_db'); // Inherited from Config
    expect(config.getWriteDatabaseName()).toBe('test_s3_db'); // Overridden
    expect(config.getResultsBucket()).toBe('test-glue-bucket'); // Always uses Glue bucket for Athena results
    expect(config.getTablesBucket()).toBe('test-s3-bucket'); // Overridden

    // Test SQL generation (overridden)
    const createQuery = config.createTableQuery('my_table', 'col1 STRING, col2 INT');
    expect(createQuery).toContain('CREATE TABLE my_table');
    expect(createQuery).toContain('col1 STRING, col2 INT');
    expect(createQuery).toContain("LOCATION 's3://test-s3-bucket/my_table/'");

    // Test inherited dropTableQuery (not overridden)
    const dropQuery = config.dropTableQuery('my_table');
    expect(dropQuery).toBe('DROP TABLE IF EXISTS my_table');

    // Test properties
    expect(config.aws_region).toBe('us-west-1');
    expect(config.glueDatabaseName).toBe('test_glue_db');
    expect(config.glueTablesBucket).toBe('test-glue-bucket');
    expect(config.s3TableDatabaseName).toBe('test_s3_db');
    expect(config.s3TablesBucket).toBe('test-s3-bucket');
    expect(config.useS3Table).toBe(true); // S3Config sets this to true

    // Test S3-specific methods
    expect(config.getS3TableCatalogName()).toBe('test-s3-bucket');
    
    // Test execution context
    const context = config.getExecutionContext();
    expect(context).toEqual({
      Catalog: 'test-s3-bucket',
      Database: 'test_s3_db'
    });
  });

  it('should test factory method behavior', () => {
    // Test without environment variable
    delete process.env.USE_S3_TABLE;
    const config1 = Config.create();
    expect(config1).toBeInstanceOf(Config);
    expect(config1.useS3Table).toBe(false);

    // Test with environment variable set to true
    process.env.USE_S3_TABLE = 'true';
    const config2 = Config.create();
    expect(config2).toBeInstanceOf(S3Config);
    expect(config2.useS3Table).toBe(true);

    // Test with environment variable set to false
    process.env.USE_S3_TABLE = 'false';
    const config3 = Config.create();
    expect(config3).toBeInstanceOf(Config);
    expect(config3.useS3Table).toBe(false);
  });

  describe("sourceBucketFromTableName", () => {
    it("should extract bucket name from objects view table", () => {
      expect(Config.sourceBucketFromTableName("test_bucket_objects-view")).toBe("test_bucket");
    });

    it("should extract bucket name from packages view table", () => {
      expect(Config.sourceBucketFromTableName("prod_registry_packages-view")).toBe("prod_registry");
    });

    it("should handle edge cases", () => {
      expect(Config.sourceBucketFromTableName("simple-view")).toBe("simple-view");
      expect(Config.sourceBucketFromTableName("")).toBe("");
    });
  });
});
