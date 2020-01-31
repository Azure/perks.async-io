import { CodeModel, Parameter, isVirtualParameter, ObjectSchema, isObjectSchema, Property, getAllParentProperties, Language, Languages } from '@azure-tools/codemodel';
import { Session } from '@azure-tools/autorest-extension-base';
import { values, length, Dictionary } from '@azure-tools/linq';
import { pascalCase, removeSequentialDuplicates, fixLeadingNumber, deconstruct, selectName, camelCase, snakeCase, formatStyle, formatter } from '@azure-tools/codegen';

function getNameOptions(typeName: string, components: Array<string>) {
  const result = new Set<string>();

  // add a variant for each incrementally inclusive parent naming scheme.
  for (let i = 0; i < length(components); i++) {
    const subset = pascalCase([...removeSequentialDuplicates(components.slice(-1 * i, length(components)))]);
    result.add(subset);
  }

  // add a second-to-last-ditch option as <typename>.<name>
  result.add(pascalCase([...removeSequentialDuplicates([...fixLeadingNumber(deconstruct(typeName)), ...deconstruct(components.last)])]));
  return [...result.values()];
}

function isUnassigned(value: string) {
  return !value || (value.indexOf('·') > -1);
}

function setName(thing: { language: Languages }, formatter: formatter, defaultValue: string) {
  thing.language.default.name = formatter(isUnassigned(thing.language.default.name) ? defaultValue : thing.language.default.name);
}

export class PreNamer {
  codeModel: CodeModel
  options: Dictionary<any> = {};
  format = {
    parameter: camelCase,
    property: camelCase,
    operation: pascalCase,
    operationGroup: pascalCase,
    choice: pascalCase,
    choiceValue: pascalCase,
    constant: pascalCase,
    type: pascalCase,
  }

  enum = 0;
  constant = 0;
  constructor(protected session: Session<CodeModel>) {
    this.codeModel = session.model;// shadow(session.model, filename);
  }

  async init() {
    // get our configuration for this run.
    this.options = await this.session.getValue('modelerfour', {});
    const naming = this.options.naming || {};
    this.format = {
      parameter: formatStyle(naming.parameter, camelCase),
      property: formatStyle(naming.property, camelCase),
      operation: formatStyle(naming.operation, pascalCase),
      operationGroup: formatStyle(naming.operationGroup, pascalCase),
      choice: formatStyle(naming.schema, pascalCase),
      choiceValue: formatStyle(naming.choiceValue, pascalCase),
      constant: formatStyle(naming.constant, pascalCase),
      type: formatStyle(naming.type, pascalCase)
    }
    return this;
  }

  isUnassigned(value: string) {
    return !value || (value.indexOf('·') > -1);
  }

  process() {
    if (this.options['prenamer'] === false) {
      return this.codeModel;
    }

    // choice
    for (const schema of values(this.codeModel.schemas.choices)) {
      setName(schema, this.format.choice, `Enum${this.enum++}`);
      for (const choice of values(schema.choices)) {
        setName(choice, this.format.choiceValue, '');
      }
    }

    // sealed choice
    for (const schema of values(this.codeModel.schemas.sealedChoices)) {
      setName(schema, this.format.choice, `Enum${this.enum++}`);
      for (const choice of values(schema.choices)) {
        setName(choice, this.format.choiceValue, '');
      }
    }

    // constant
    for (const schema of values(this.codeModel.schemas.constants)) {
      setName(schema, this.format.constant, `Constant${this.enum++}`);
    }

    // strings
    for (const schema of values(this.codeModel.schemas.strings)) {
      setName(schema, this.format.type, schema.type);
    }

    // number
    for (const schema of values(this.codeModel.schemas.numbers)) {
      setName(schema, this.format.type, schema.type);
    }

    for (const schema of values(this.codeModel.schemas.dates)) {
      setName(schema, this.format.type, schema.type);
    }
    for (const schema of values(this.codeModel.schemas.dateTimes)) {
      setName(schema, this.format.type, schema.type);
    }
    for (const schema of values(this.codeModel.schemas.durations)) {
      setName(schema, this.format.type, schema.type);
    }
    for (const schema of values(this.codeModel.schemas.uuids)) {
      setName(schema, this.format.type, schema.type);
    }

    for (const schema of values(this.codeModel.schemas.uris)) {
      setName(schema, this.format.type, schema.type);
    }

    for (const schema of values(this.codeModel.schemas.unixtimes)) {
      setName(schema, this.format.type, schema.type);

      if (isUnassigned(schema.language.default.description)) {
        schema.language.default.description = 'date in seconds since 1970-01-01T00:00:00Z.';
      }
    }

    for (const schema of values(this.codeModel.schemas.byteArrays)) {
      setName(schema, this.format.type, schema.type);
    }

    for (const schema of values(this.codeModel.schemas.chars)) {
      setName(schema, this.format.type, schema.type);
    }

    for (const schema of values(this.codeModel.schemas.booleans)) {
      setName(schema, this.format.type, schema.type);
    }

    for (const schema of values(this.codeModel.schemas.flags)) {
      setName(schema, this.format.type, schema.type);
    }

    // dictionary
    for (const schema of values(this.codeModel.schemas.dictionaries)) {
      setName(schema, this.format.type, `DictionaryOf${schema.elementType.language.default.name}`);
      if (isUnassigned(schema.language.default.description)) {
        schema.language.default.description = `Dictionary of ${schema.elementType.language.default.name}`;
      }
    }

    for (const schema of values(this.codeModel.schemas.arrays)) {
      setName(schema, this.format.type, `ArrayOf${schema.elementType.language.default.name}`);
      if (this.isUnassigned(schema.language.default.description)) {
        schema.language.default.description = `Array of ${schema.elementType.language.default.name}`;
      }
    }


    for (const schema of values(this.codeModel.schemas.objects)) {
      setName(schema, this.format.type, '');
      for (const property of values(schema.properties)) {
        setName(property, this.format.property, '');
      }
    }

    for (const operationGroup of this.codeModel.operationGroups) {
      setName(operationGroup, this.format.operationGroup, operationGroup.$key);
      for (const operation of operationGroup.operations) {
        setName(operation, this.format.operation, '');
        for (const parameter of values(operation.request.signatureParameters)) {
          setName(parameter, this.format.parameter, '');
        }
      }
    }


    // fix collisions from flattening on ObjectSchemas
    this.fixPropertyCollisions();

    // fix collisions from flattening on VirtualParameters
    this.fixParameterCollisions();




    return this.codeModel;
  }
  fixParameterCollisions() {
    for (const operation of values(this.codeModel.operationGroups).selectMany(each => each.operations)) {
      const parameters = values(operation.request.signatureParameters);

      const usedNames = new Set<string>();
      const collisions = new Set<Parameter>();

      // we need to make sure we avoid name collisions. operation parameters get first crack.
      for (const each of values(parameters)) {
        const name = each.language.default.name;
        if (usedNames.has(name)) {
          collisions.add(each);
        } else {
          usedNames.add(name);
        }
      }

      // handle operation parameters
      for (const parameter of collisions) {
        console.log(`parameter collison fix on ${parameter.language.default.name} `)
        let options = [parameter.language.default.name];
        if (isVirtualParameter(parameter)) {
          options = getNameOptions(parameter.schema.language.default.name, [parameter.language.default.name, ...parameter.pathToProperty.map(each => each.language.default.name)]);
        }
        parameter.language.default.name = this.format.parameter(selectName(options, usedNames));
      }
    }

  }

  fixCollisions(schema: ObjectSchema) {
    for (const each of values(schema.parents?.immediate).where(each => isObjectSchema(each))) {
      this.fixCollisions(<ObjectSchema>each);
    }
    const [owned, flattened] = values(schema.properties).bifurcate(each => length(each.flattenedNames) === 0);
    const inherited = [...getAllParentProperties(schema)];

    const all = [...owned, ...inherited, ...flattened];

    const inlined = new Map<string, number>();
    for (const each of all) {
      const name = this.format.property(each.language.default.name);
      // track number of instances of a given name.
      inlined.set(name, (inlined.get(name) || 0) + 1);
    }

    const usedNames = new Set(inlined.keys());
    for (const each of flattened /*.sort((a, b) => length(a.nameOptions) - length(b.nameOptions)) */) {
      const ct = inlined.get(this.format.property(each.language.default.name));
      if (ct && ct > 1) {
        console.error(`Fixing collision on name ${each.language.default.name} #${ct} `);
        const options = getNameOptions(each.schema.language.default.name, [each.language.default.name, ...values(each.flattenedNames)]);
        each.language.default.name = this.format.property(selectName(options, usedNames));
      }
    }
  }

  fixPropertyCollisions() {
    for (const schema of values(this.codeModel.schemas.objects)) {
      this.fixCollisions(schema);
    }
  }
}
