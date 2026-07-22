import { toRubyPascalCase, toSnakeCase } from '../../../src/docgen/transpile/ruby';

describe('toRubyPascalCase', () => {
  test('renders plain PascalCase when no acronyms are provided', () => {
    expect(toRubyPascalCase('xyzThing')).toEqual('XyzThing');
    expect(toRubyPascalCase('vpcEndpoint')).toEqual('VpcEndpoint');
    expect(toRubyPascalCase('aws-ecr')).toEqual('AwsEcr');
    expect(toRubyPascalCase('repository')).toEqual('Repository');
  });

  test('honors acronyms declared by the assembly', () => {
    expect(toRubyPascalCase('XyzThing', ['XYZ'])).toEqual('XYZThing');
    expect(toRubyPascalCase('xyzThing', ['XYZ'])).toEqual('XYZThing');
    expect(toRubyPascalCase('vpcEndpoint', ['VPC'])).toEqual('VPCEndpoint');
    expect(toRubyPascalCase('aws-ecr', ['AWS', 'ECR'])).toEqual('AWSECR');
  });

  test('acronyms only apply when declared', () => {
    // same input, different assembly-declared acronym sets
    expect(toRubyPascalCase('vpcEndpoint', [])).toEqual('VpcEndpoint');
    expect(toRubyPascalCase('vpcEndpoint', ['VPC'])).toEqual('VPCEndpoint');
  });

  test('short acronym tokens do not over-match inside words', () => {
    const acronyms = ['CE', 'RAM', 'DB', 'IP'];
    expect(toRubyPascalCase('Certificate', acronyms)).toEqual('Certificate');
    expect(toRubyPascalCase('Ramp', acronyms)).toEqual('Ramp');
    expect(toRubyPascalCase('Database', acronyms)).toEqual('Database');
    expect(toRubyPascalCase('Description', acronyms)).toEqual('Description');
    expect(toRubyPascalCase('Script', acronyms)).toEqual('Script');
  });

  test('short acronym tokens still match as standalone words', () => {
    const acronyms = ['CE', 'RAM', 'DB', 'IP'];
    expect(toRubyPascalCase('DbInstance', acronyms)).toEqual('DBInstance');
    expect(toRubyPascalCase('IpAddresses', acronyms)).toEqual('IPAddresses');
    expect(toRubyPascalCase('RamResourceShare', acronyms)).toEqual('RAMResourceShare');
  });
});

describe('toSnakeCase', () => {
  test('converts camelCase to snake_case', () => {
    expect(toSnakeCase('instanceType')).toEqual('instance_type');
    expect(toSnakeCase('vpcEndpointId')).toEqual('vpc_endpoint_id');
  });

  test('prefixes reserved Ruby keywords with an underscore', () => {
    expect(toSnakeCase('class')).toEqual('_class');
    expect(toSnakeCase('end')).toEqual('_end');
  });

  test('prefixes names starting with a digit', () => {
    expect(toSnakeCase('2xlarge')).toEqual('_2xlarge');
  });

  test('round-trips with toRubyPascalCase', () => {
    // without acronyms, snake -> pascal -> snake is stable
    expect(toSnakeCase(toRubyPascalCase('xyz_thing'))).toEqual('xyz_thing');
    expect(toSnakeCase(toRubyPascalCase('instance_type'))).toEqual('instance_type');
    // acronym casing is derived from the same snake/camel source name
    expect(toRubyPascalCase(toSnakeCase('xyzThing'), ['XYZ'])).toEqual('XYZThing');
    expect(toRubyPascalCase(toSnakeCase('vpcEndpoint'), ['VPC'])).toEqual('VPCEndpoint');
  });
});
