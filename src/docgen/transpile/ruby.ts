import * as reflect from 'jsii-reflect';
import * as transpile from './transpile';
import { submodulePath } from '../schema';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Case = require('case');

const RUBY_RESERVED_NAMES = new Set([
  'alias',
  'and',
  'begin',
  'break',
  'case',
  'class',
  'def',
  'defined?',
  'do',
  'else',
  'elsif',
  'end',
  'ensure',
  'false',
  'for',
  'if',
  'in',
  'module',
  'next',
  'nil',
  'not',
  'or',
  'redo',
  'rescue',
  'retry',
  'return',
  'self',
  'super',
  'then',
  'true',
  'undef',
  'unless',
  'until',
  'when',
  'while',
  'yield',
  '__send__',
  'send',
]);

const DEFAULT_ACRONYMS = [
  'AWS',
  'S3',
  'IAM',
  'VPC',
  'CDK',
  'SQS',
  'SNS',
  'EC2',
  'RDS',
  'KMS',
  'ECS',
  'EKS',
  'EFS',
  'ELB',
  'WAF',
  'SSM',
  'SES',
  'SAM',
  'MSK',
  'MWAA',
  'ACM',
  'EMR',
  'FSX',
  'QLDB',
  'RAM',
  'FMS',
  'DAX',
  'DMS',
  'DLM',
  'FIS',
  'IVS',
  'CUR',
  'OAM',
  'PCS',
  'RUM',
  'CE',
  'APS',
  'DSQL',
  'ARN',
  'API',
  'DB',
  'CIDR',
  'IP',
  'DNS',
];

/**
 * Converts a camelCase/PascalCase identifier name to snake_case format.
 * Prepends an underscore if the name matches a reserved Ruby keyword or starts with a digit.
 */
function toSnakeCase(name: string): string {
  const snake = Case.snake(name);
  if (RUBY_RESERVED_NAMES.has(snake)) {
    return `_${snake}`;
  }
  if (/^\d/.test(snake)) {
    return `_${snake}`;
  }
  return snake;
}

/**
 * Converts a hyphenated/cased name to PascalCase for Ruby, preserving case-insensitive acronyms.
 * Restores fully capitalized acronyms (e.g. AWS, S3, VPC) using word boundaries.
 */
export function toRubyPascalCase(name: string, acronyms: string[] = DEFAULT_ACRONYMS): string {
  if (name.includes('-')) {
    return name.split('-').map((p) => toRubyPascalCase(p, acronyms)).join('');
  }
  const sanitized = name.replace(/[^a-zA-Z0-9_]/g, '');
  let pascal = Case.pascal(sanitized);

  for (const acronym of acronyms) {
    const regex = new RegExp(`(${acronym})`, 'ig');
    pascal = pascal.replace(regex, (match: string, _p1: string, offset: number) => {
      if (match[0] !== match[0].toUpperCase()) return match;
      const nextChar = pascal[offset + match.length];
      if (nextChar) {
        const isValid =
          /^[A-Z0-9]$/.test(nextChar) ||
          (nextChar === 's' &&
            (!pascal[offset + match.length + 1] || /^[A-Z0-9]$/.test(pascal[offset + match.length + 1])));
        if (!isValid) return match;
      }
      return acronym;
    });
  }
  return pascal;
}

/**
 * Formats a package/assembly name to a Ruby module namespace.
 * Handles scoped packages (e.g., @scope/pkg-name -> Scope::PkgName).
 */
function rubyModuleForAssembly(name: string, acronyms: string[]): string {
  if (name.startsWith('@')) {
    return name.slice(1).split('/').map(p => toRubyPascalCase(p, acronyms)).join('::');
  }
  return name.split('-').map(p => toRubyPascalCase(p, acronyms)).join('::');
}

/**
 * Resolves the corresponding Ruby Gem name for a JSII assembly,
 * checking explicit targets.ruby.gem targets or falling back to a sanitization of the npm name.
 */
function rubyGemName(assembly: reflect.Assembly): string {
  return assembly.targets?.ruby?.gem ?? assembly.name.replace(/^@/, '').replace(/\//g, '-');
}

/**
 * Resolves the fully-qualified Ruby module/class path for a JSII type.
 * Recursively ascends the type hierarchy and submodules, resolving explicit `ruby.module`
 * targets if specified in assembly configurations.
 */
function rubyFullTypeName(type: reflect.Type): string {
  const fqn = type.fqn;
  if (fqn === 'any') return 'Object';

  const segments = fqn.split('.');
  const assemblyName = segments[0];
  const system = type.system;

  let assembly: reflect.Assembly;
  try {
    assembly = system.findAssembly(assemblyName);
  } catch {
    const acronyms = DEFAULT_ACRONYMS;
    return segments.map((p) => toRubyPascalCase(p, acronyms)).join('::');
  }

  const acronyms = assembly.targets?.ruby?.acronyms ?? DEFAULT_ACRONYMS;
  const assemblyModule = assembly.targets?.ruby?.module ?? rubyModuleForAssembly(assemblyName, acronyms);
  const result = [];

  for (let len = segments.length; len > 0; len--) {
    const submoduleFqn = segments.slice(0, len).join('.');

    if (submoduleFqn === assemblyName) {
      result.unshift(assemblyModule);
      break;
    }

    let explicitModule: string | undefined;
    try {
      const sub = system.findFqn(submoduleFqn);
      if (sub instanceof reflect.Submodule) {
        explicitModule = sub.targets?.ruby?.module;
      }
    } catch {
      // ignore
    }

    if (explicitModule) {
      result.unshift(explicitModule);
      break;
    }

    result.unshift(toRubyPascalCase(segments[len - 1], acronyms));
  }

  return result.join('::');
}

const formatArguments = (inputs: string[]) => {
  return inputs.join(', ');
};

const formatStructInitialization = (type: transpile.TranspiledType) => {
  const target = type.submodule ? `${type.namespace}::${type.name}` : type.name;
  return `${target}.new( ... )`;
};

const formatClassInitialization = (
  type: transpile.TranspiledType,
  inputs: string[],
) => {
  const target = type.submodule ? `${type.namespace}::${type.name}` : type.name;
  return `${target}.new(${formatArguments(inputs)})`;
};

const formatInvocation = (
  type: transpile.TranspiledType,
  inputs: string[],
  method?: string,
) => {
  let target = type.submodule ? `${type.namespace}::${type.name}` : type.name;
  if (method) {
    target = `${target}.${method}`;
  }
  return `${target}(${formatArguments(inputs)})`;
};

const formatImport = (type: transpile.TranspiledType) => {
  return `require '${rubyGemName(type.source.assembly)}'`;
};

const formatSignature = (name: string, inputs: string[]) => {
  return inputs.length > 0 ? `def ${name}(${formatArguments(inputs)})` : `def ${name}`;
};

/**
 * Hack to convert a jsii property to a parameter for
 * Ruby specific parameter expansion (analogous to Python).
 */
const propertyToParameter = (
  callable: reflect.Callable,
  property: reflect.Property,
): reflect.Parameter => {
  return {
    docs: property.docs,
    method: callable,
    name: property.name,
    optional: property.optional,
    parentType: callable.parentType,
    spec: property.spec,
    system: property.system,
    type: property.type,
    variadic: false,
  };
};

/**
 * Transpiler that maps JSII assembly types and signatures into idiomatic Ruby structures.
 * Used by jsii-docgen to render type references and call syntax in documentation blocks.
 */
export class RubyTranspile extends transpile.TranspileBase {
  constructor() {
    super(transpile.Language.RUBY);
  }

  /**
   * Processes the README content. Passes the original markdown readme straight through.
   */
  public readme(readme: string): string {
    return readme;
  }

  /**
   * Renders a type union as a string representation separated by 'or'.
   */
  public unionOf(types: string[]): string {
    return types.join(' or ');
  }

  /**
   * Renders a type intersection as a string representation separated by 'and'.
   */
  public intersectionOf(types: string[]): string {
    return types.join(' and ');
  }

  /**
   * Formats a generic list type as a Ruby Array structure (e.g. `Array<Type>`).
   */
  public listOf(type: string): string {
    return `Array<${type}>`;
  }

  /**
   * Formats a variadic parameter suffix (e.g., `*Type`).
   */
  public variadicOf(type: string): string {
    return `*${type}`;
  }

  /**
   * Formats a dictionary/map structure as a Ruby Hash mapping strings to the value type.
   */
  public mapOf(type: string): string {
    return `Hash{String => ${type}}`;
  }

  /**
   * Formats the fallback type representing any dynamic/unknown value in Ruby.
   */
  public any(): string {
    return 'Object';
  }

  /**
   * Formats the type representing no return value.
   */
  public void(): string {
    return 'void';
  }

  /**
   * Formats the boolean primitive type name in Ruby.
   */
  public boolean(): string {
    return 'Boolean';
  }

  /**
   * Formats the string primitive type name in Ruby.
   */
  public str(): string {
    return 'String';
  }

  /**
   * Formats the number primitive type name in Ruby.
   */
  public number(): string {
    return 'Numeric';
  }

  /**
   * Formats the date/time primitive type name in Ruby.
   */
  public date(): string {
    return 'Time';
  }

  /**
   * Formats JSON/raw objects as a Ruby Hash.
   */
  public json(): string {
    return 'Hash';
  }

  /**
   * Transpiles a JSII Enum definition to a Ruby representation.
   */
  public enum(enu: reflect.EnumType): transpile.TranspiledEnum {
    return {
      fqn: this.type(enu).fqn,
      name: toRubyPascalCase(enu.name, enu.assembly.targets?.ruby?.acronyms ?? DEFAULT_ACRONYMS),
    };
  }

  /**
   * Transpiles a JSII Enum member reference to a Ruby constant representation.
   */
  public enumMember(em: reflect.EnumMember): transpile.TranspiledEnumMember {
    return {
      fqn: `${this.enum(em.enumType).fqn}::${Case.constant(em.name)}`,
      name: Case.constant(em.name),
    };
  }

  /**
   * Transpiles a class/interface property definition to its Ruby representation.
   */
  public property(property: reflect.Property): transpile.TranspiledProperty {
    const name = toSnakeCase(property.name);
    const typeRef = this.typeReference(property.type);
    return {
      name,
      parentType: this.type(property.parentType),
      typeReference: typeRef,
      optional: property.optional,
      declaration: property.immutable ? `attr_reader :${name}` : `attr_accessor :${name}`,
    };
  }

  /**
   * Transpiles a JSII Class type definition into its Ruby metadata representation.
   */
  public class(klass: reflect.ClassType): transpile.TranspiledClass {
    const type = this.type(klass);
    return {
      name: type.name,
      type,
    };
  }

  /**
   * Transpiles a callable parameter/property to its Ruby parameter representation.
   */
  public parameter(
    parameter: reflect.Parameter | reflect.Property,
  ): transpile.TranspiledParameter {
    const name = toSnakeCase(parameter.name);
    const typeRef = this.typeReference(parameter.type);
    return {
      name,
      parentType: this.type(parameter.parentType),
      typeReference: typeRef,
      optional: parameter.optional,
      variadic: 'variadic' in parameter ? parameter.variadic : false,
      declaration: name,
    };
  }

  /**
   * Transpiles a JSII data-only struct interface type to a Ruby representation.
   */
  public struct(struct: reflect.InterfaceType): transpile.TranspiledStruct {
    const type = this.type(struct);
    return {
      type: type,
      name: type.name,
      import: formatImport(type),
      initialization: formatStructInitialization(type),
    };
  }

  /**
   * Transpiles a constructor or method callable signature.
   * Flattens parameter lists, expands structs (analogous to Python keyword-only args),
   * and renders signature lines and class initialization snippets.
   */
  public callable(callable: reflect.Callable): transpile.TranspiledCallable {
    const type = this.type(callable.parentType);

    const parameters = new Array<reflect.Parameter>();

    for (const p of callable.parameters.sort(this.optionalityCompare)) {
      if (!this.isStruct(p)) {
        parameters.push(p);
      } else {
        const struct = p.parentType.system.findInterface(p.type.fqn!);
        for (const property of struct.allProperties) {
          const parameter = propertyToParameter(callable, property);
          parameters.push(parameter);
        }
      }
    }

    const name = toSnakeCase(callable.name);
    const inputs = parameters.map((p) => this.formatParameters(this.parameter(p)));

    return {
      name,
      parentType: type,
      import: formatImport(type),
      parameters,
      signatures: [formatSignature(name, inputs)],
      invocations: [
        reflect.Initializer.isInitializer(callable)
          ? formatClassInitialization(type, inputs)
          : formatInvocation(type, inputs, name),
      ],
    };
  }

  /**
   * Transpiles a general JSII Type reference into fully-qualified Ruby modules,
   * tracking nested submodules, namespace structures, and package Gem names.
   */
  public type(type: reflect.Type): transpile.TranspiledType {
    const submodule = this.findSubmodule(type);
    const acronyms = type.assembly.targets?.ruby?.acronyms ?? DEFAULT_ACRONYMS;

    const fqn = rubyFullTypeName(type);
    const fqnParts = fqn.split('::');
    const name = fqnParts[fqnParts.length - 1];
    const namespace = fqnParts.slice(0, -1).join('::') || undefined;
    const gem = rubyGemName(type.assembly);

    return new transpile.TranspiledType({
      fqn,
      name,
      namespace,
      module: gem,
      submodule: submodule ? toRubyPascalCase(submodule.name, acronyms) : undefined,
      submodulePath: submodulePath(submodule),
      source: type,
      language: this.language,
    });
  }

  /**
   * Transpiles a JSII module or submodule to its Ruby namespace representation.
   */
  public moduleLike(
    moduleLike: reflect.ModuleLike,
  ): transpile.TranspiledModuleLike {
    const assembly = moduleLike instanceof reflect.Submodule ? moduleLike.parent : (moduleLike as reflect.Assembly);
    const acronyms = assembly.targets?.ruby?.acronyms ?? DEFAULT_ACRONYMS;

    if (moduleLike instanceof reflect.Submodule) {
      const parentRubyModule = assembly.targets?.ruby?.module ?? rubyModuleForAssembly(assembly.name, acronyms);

      const submoduleRubyModule = moduleLike.targets?.ruby?.module ?? `${parentRubyModule}::${toRubyPascalCase(moduleLike.name, acronyms)}`;

      const moduleParts = submoduleRubyModule.split('::');
      return { name: moduleParts.slice(0, -1).join('::'), submodule: moduleParts[moduleParts.length - 1] };
    }

    const rubyModule = moduleLike.targets?.ruby?.module ?? rubyModuleForAssembly((moduleLike as reflect.Assembly).name, acronyms);
    return { name: rubyModule };
  }

  /**
   * Transpiles a behavioral JSII interface type to its Ruby representation.
   */
  public interface(
    iface: reflect.InterfaceType,
  ): transpile.TranspiledInterface {
    const type = this.type(iface);
    return {
      name: type.name,
      type,
    };
  }

  private isStruct(p: reflect.Parameter): boolean {
    return p.type.fqn ? p.system.findFqn(p.type.fqn).isDataType() : false;
  }

  /**
   * Formats the parameters for method signatures and invocation examples.
   * Since Ruby has no inline type annotations, parameters are rendered as standard
   * positional parameters (e.g. name, name = nil, *name).
   */
  private formatParameters(
    transpiled: transpile.TranspiledParameter,
  ): string {
    if (transpiled.variadic) {
      return `*${transpiled.name}`;
    }
    return transpiled.optional ? `${transpiled.name} = nil` : transpiled.name;
  }
}
