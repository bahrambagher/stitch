import { print } from 'graphql';
import { gql } from 'apollo-server-core';
import { GraphQLClient } from 'graphql-request';
import { PolicyArgsDefinitions, PolicyDefinition, PolicyType } from '../../../src/modules/resource-repository';
import GraphQLErrorSerializer from '../../utils/graphql-error-serializer';
import { updateGatewaySchema } from '../../helpers/utility';
import { RegistryMutationResponse, updatePoliciesMutation } from '../../helpers/registry-request-builder';
import { getToken } from '../../helpers/get-token';

interface TestCase {
  code: string;
  args?: PolicyArgsDefinitions;
  argsLiteral?: string;
}

const gatewayClient = new GraphQLClient('http://localhost:8080/graphql');
const registryClient = new GraphQLClient('http://localhost:8090/graphql');

const testCases: [string, TestCase][] = [
  [
    'no_args',
    {
      code: `
        default allow = true
      `,
    },
  ],
  [
    'mandatory_arg',
    {
      code: `
        default allow = false
        allow {
          input.args.arg1
        }
      `,
      args: {
        arg1: {
          type: 'Boolean!',
        },
      },
      argsLiteral: '(arg1: true)',
    },
  ],
  [
    'mandatory_arg_with_default',
    {
      code: `
        default allow = false
        allow {
          input.args.arg1
        }
      `,
      args: {
        arg1: {
          type: 'Boolean!',
          default: '{true}',
        },
      },
    },
  ],
  [
    'optional_arg',
    {
      code: `
        default allow = false
        allow {
          input.args.arg1
        }
        allow {
          input.args.arg1 == null
        }
      `,
      args: {
        arg1: {
          type: 'Boolean',
        },
      },
      argsLiteral: '(arg1: true)',
    },
  ],
  [
    'optional_arg_not_set',
    {
      code: `
        default allow = false
        allow {
          input.args.arg1
        }
        allow {
          input.args.arg1 == null
        }
      `,
      args: {
        arg1: {
          type: 'Boolean',
        },
      },
    },
  ],
  [
    'optional_arg_with_default',
    {
      code: `
        default allow = false
        allow {
          input.args.arg1
        }
        allow {
          input.args.arg1 == null
        }
      `,
      args: {
        arg1: {
          type: 'Boolean',
          default: '{true}',
        },
      },
    },
  ],
];

describe('Policies as query field', () => {
  const namespace = 'e2e_policies_as_query_field';

  beforeAll(async () => {
    expect.addSnapshotSerializer(GraphQLErrorSerializer);

    const accessToken = await getToken();
    gatewayClient.setHeader('Authorization', `Bearer ${accessToken}`);
  });

  test('Setup policies', async () => {
    const policies: PolicyDefinition[] = testCases.map(([name, { code, args }]) => ({
      metadata: {
        namespace,
        name,
      },
      type: PolicyType.opa,
      code,
      args,
    }));

    const policiesResponse = await registryClient.request<RegistryMutationResponse>(updatePoliciesMutation, {
      policies,
    });
    expect(policiesResponse.result.success).toBeTruthy();

    const resp = await updateGatewaySchema('http://localhost:8080');
    expect(resp.status).toEqual(200);
  });

  test.each(testCases)('%s', async (name, { argsLiteral = '' }) => {
    const query = print(gql`
      query CheckPolicy {
        policy {
          ${namespace}___${name}${argsLiteral} {
            allow
          }
        }
      }
    `);

    const response = await gatewayClient.request(query);
    expect(response).toMatchSnapshot();
  });
});
