import { SchemaDirectiveVisitor, makeRemoteExecutableSchema, delegateToSchema, introspectSchema } from 'graphql-tools';
import { GraphQLField } from 'graphql';
import { gql } from 'apollo-server-core';
import { ApolloLink } from 'apollo-link';
import { HttpLink } from 'apollo-link-http';
import { RetryLink } from 'apollo-link-retry';
import { setContext } from 'apollo-link-context';
import fetch from 'node-fetch';
import { FastifyRequest } from 'fastify';
import { deepInject } from '../arguments-injection';
import { getAuthHeaders, AuthenticationConfig } from '../upstream-authentication';
import logger from '../logger';
import { RequestContext } from '../context';

export class GqlDirective extends SchemaDirectiveVisitor {
  async createRemoteSchema(url: string, config: AuthenticationConfig) {
    const httpLink: ApolloLink = new HttpLink({ uri: url, fetch: fetch as any, fetchOptions: { timeout: 10000 } });
    const authLink = setContext(async (_, context) => ({
      headers: await getAuthHeaders(config, new URL(url).host, context?.graphqlContext?.request as FastifyRequest),
    })).concat(httpLink);
    const retryLink = new RetryLink({
      delay: { max: 5000 },
      attempts: {
        max: 10,
        retryIf(error) {
          logger.warn({ error, url }, 'Failed fetching introspection query');
          return !!error;
        },
      },
    }).concat(authLink);

    // Only introspection should retry, because if we don't have the introspection result this entire resolver will fail.
    // Normal gql requests should not retry, at least for now, because that is more complicated than introspection.
    return await introspectSchema(retryLink).then(schema => makeRemoteExecutableSchema({ schema, link: authLink }));
  }

  visitFieldDefinition(field: GraphQLField<unknown, RequestContext>) {
    const { url, fieldName, arguments: gqlArgs, operationType: operationTypeParam } = this.args;
    const operationType = operationTypeParam?.toLowerCase() ?? 'query';
    const remoteSchema = this.createRemoteSchema(url, this.context.authenticationConfig);

    field.resolve = async (parent, args, context, info) => {
      return await delegateToSchema({
        schema: await remoteSchema,
        operation: operationType,
        fieldName,
        args: deepInject(gqlArgs, parent, args, context, info),
        context,
        info,
      });
    };
  }
}

export const sdl = gql`
  enum GraphQLOperationType {
    Query
    Mutation
  }

  directive @gql(
    url: String!
    fieldName: String!
    operationType: GraphQLOperationType
    arguments: JSONObject
  ) on FIELD_DEFINITION
`;
