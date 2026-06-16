import { relations } from 'drizzle-orm'
import {
  organizations,
  organizationMembers,
  invitations,
  users,
  environments,
  databaseConnections,
  schemaSnapshots,
  customRoles,
  policies,
  queryLogs,
  approvalRequests,
  auditLogs,
} from './schema/index'

export const organizationsRelations = relations(organizations, ({ many }) => ({
  members: many(organizationMembers),
  invitations: many(invitations),
  environments: many(environments),
  databaseConnections: many(databaseConnections),
  customRoles: many(customRoles),
  policies: many(policies),
  queryLogs: many(queryLogs),
  auditLogs: many(auditLogs),
}))

export const organizationMembersRelations = relations(organizationMembers, ({ one }) => ({
  organization: one(organizations, {
    fields: [organizationMembers.orgId],
    references: [organizations.id],
  }),
  user: one(users, {
    fields: [organizationMembers.userId],
    references: [users.id],
  }),
}))

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(organizationMembers),
  queryLogs: many(queryLogs),
  reviewedApprovals: many(approvalRequests),
  auditLogs: many(auditLogs),
}))

export const environmentsRelations = relations(environments, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [environments.orgId],
    references: [organizations.id],
  }),
  databaseConnections: many(databaseConnections),
}))

export const databaseConnectionsRelations = relations(databaseConnections, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [databaseConnections.orgId],
    references: [organizations.id],
  }),
  environment: one(environments, {
    fields: [databaseConnections.environmentId],
    references: [environments.id],
  }),
  schemaSnapshots: many(schemaSnapshots),
  queryLogs: many(queryLogs),
}))

export const schemaSnapshotsRelations = relations(schemaSnapshots, ({ one }) => ({
  connection: one(databaseConnections, {
    fields: [schemaSnapshots.connectionId],
    references: [databaseConnections.id],
  }),
}))

export const queryLogsRelations = relations(queryLogs, ({ one }) => ({
  organization: one(organizations, {
    fields: [queryLogs.orgId],
    references: [organizations.id],
  }),
  user: one(users, {
    fields: [queryLogs.userId],
    references: [users.id],
  }),
  connection: one(databaseConnections, {
    fields: [queryLogs.connectionId],
    references: [databaseConnections.id],
  }),
  approvalRequest: one(approvalRequests, {
    fields: [queryLogs.id],
    references: [approvalRequests.queryLogId],
  }),
}))

export const approvalRequestsRelations = relations(approvalRequests, ({ one }) => ({
  queryLog: one(queryLogs, {
    fields: [approvalRequests.queryLogId],
    references: [queryLogs.id],
  }),
  reviewer: one(users, {
    fields: [approvalRequests.reviewerId],
    references: [users.id],
  }),
}))

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  organization: one(organizations, {
    fields: [auditLogs.orgId],
    references: [organizations.id],
  }),
  actor: one(users, {
    fields: [auditLogs.actorId],
    references: [users.id],
  }),
}))
