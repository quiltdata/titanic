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
    expect(config.formatTableName('test_table')).toBe('"test_table"');
  });

  it('should return correct tables bucket for Glue config', () => {
    const config = Config.createTestInstance({
      glueTablesBucket: 'glue-bucket',
      s3TablesBucket: 's3-bucket',
    });

    expect(config.getResultsBucket()).toBe('glue-bucket');
    expect(config.getTablesBucket()).toBe('glue-bucket');
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
    expect(config.formatTableName('test_table', true)).toBe('s3_db.test_table');
    expect(config.formatTableName('test_table', false)).toBe('glue_db.test_table');
  });

  it('should create correct table queries', () => {
    const config = S3Config.createTestInstance({
      s3TableDatabaseName: 's3_db',
      s3TablesBucket: 's3-bucket',
    });

    const createQuery = config.createTableQuery('test_table', 'id int, name string');
    expect(createQuery).toContain('CREATE TABLE s3_db.test_table');
    expect(createQuery).toContain("LOCATION 's3://s3-bucket/test_table/'");

    const dropQuery = config.dropTableQuery('test_table');
    expect(dropQuery).toBe('DROP TABLE s3_db.test_table');
  });
});
