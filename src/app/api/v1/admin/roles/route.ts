import { NextResponse } from 'next/server';
import { authorizeRequest, logAudit } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

/**
 * GET /api/v1/admin/roles — List all roles with their permissions
 * Permission: system.manage_roles
 */
export async function GET(request: Request) {
  try {
    const auth = await authorizeRequest(request, 'system.manage_roles');
    if (!auth.authorized) return auth.errorResponse!;

    const { data: roles, error } = await supabaseAdmin
      .from('roles')
      .select('*, role_permissions(*, permissions(*))')
      .order('name');

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch roles' },
        { status: 500 }
      );
    }

    logAudit(auth.userId, {
      action: 'view',
      resourceType: 'roles',
    });

    return NextResponse.json({ data: roles || [] });
  } catch (err) {
    logger.error('admin_roles_list_failed', { error: err instanceof Error ? err : new Error(String(err)), route: '/api/v1/admin/roles' });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/v1/admin/roles — Create a new role
 * Permission: system.manage_roles
 *
 * Body: { name: string, description?: string, permissions?: string[] }
 */
export async function POST(request: Request) {
  try {
    const auth = await authorizeRequest(request, 'system.manage_roles');
    if (!auth.authorized) return auth.errorResponse!;

    const body = await request.json();

    if (!body.name || typeof body.name !== 'string') {
      return NextResponse.json(
        { error: 'Role name is required' },
        { status: 400 }
      );
    }

    // Validate role name format (alphanumeric, underscores, hyphens)
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{1,49}$/.test(body.name)) {
      return NextResponse.json(
        {
          error:
            'Invalid role name. Must start with a letter, contain only alphanumeric characters, underscores, or hyphens, and be 2-50 characters.',
        },
        { status: 400 }
      );
    }

    // Check for duplicate role name
    const { data: existing } = await supabaseAdmin
      .from('roles')
      .select('id')
      .eq('name', body.name)
      .single();

    if (existing) {
      return NextResponse.json(
        { error: 'A role with this name already exists' },
        { status: 409 }
      );
    }

    // Create the role
    const { data: role, error: roleError } = await supabaseAdmin
      .from('roles')
      .insert({
        name: body.name,
        description: body.description || null,
      })
      .select()
      .single();

    if (roleError) {
      return NextResponse.json(
        { error: 'Failed to create role' },
        { status: 500 }
      );
    }

    // Assign permissions if provided
    if (body.permissions && Array.isArray(body.permissions) && body.permissions.length > 0) {
      // Resolve permission IDs
      const { data: permissionRecords } = await supabaseAdmin
        .from('permissions')
        .select('id, name')
        .in('name', body.permissions);

      if (permissionRecords && permissionRecords.length > 0) {
        const rolePermissions = permissionRecords.map((p) => ({
          role_id: role.id,
          permission_id: p.id,
        }));

        await supabaseAdmin.from('role_permissions').insert(rolePermissions);
      }
    }

    logAudit(auth.userId, {
      action: 'create',
      resourceType: 'role',
      resourceId: role.id,
      details: {
        name: body.name,
        permissions: body.permissions || [],
      },
    });

    return NextResponse.json({ data: role }, { status: 201 });
  } catch (err) {
    logger.error('admin_roles_create_failed', { error: err instanceof Error ? err : new Error(String(err)), route: '/api/v1/admin/roles' });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/v1/admin/roles — Update a role's permissions
 * Permission: system.manage_roles
 *
 * Body: { role_id: string, permissions: string[] }
 * Replaces all permissions for the given role.
 */
export async function PATCH(request: Request) {
  try {
    const auth = await authorizeRequest(request, 'system.manage_roles');
    if (!auth.authorized) return auth.errorResponse!;

    const body = await request.json();

    if (!body.role_id || !Array.isArray(body.permissions)) {
      return NextResponse.json(
        { error: 'role_id and permissions array are required' },
        { status: 400 }
      );
    }

    // Verify the role exists
    const { data: role } = await supabaseAdmin
      .from('roles')
      .select('id, name')
      .eq('id', body.role_id)
      .single();

    if (!role) {
      return NextResponse.json(
        { error: 'Role not found' },
        { status: 404 }
      );
    }

    // Remove existing permission assignments
    await supabaseAdmin
      .from('role_permissions')
      .delete()
      .eq('role_id', body.role_id);

    // Assign new permissions
    if (body.permissions.length > 0) {
      const { data: permissionRecords } = await supabaseAdmin
        .from('permissions')
        .select('id, name')
        .in('name', body.permissions);

      if (permissionRecords && permissionRecords.length > 0) {
        const rolePermissions = permissionRecords.map((p) => ({
          role_id: body.role_id,
          permission_id: p.id,
        }));

        const { error: insertError } = await supabaseAdmin
          .from('role_permissions')
          .insert(rolePermissions);

        if (insertError) {
          return NextResponse.json(
            { error: 'Failed to update permissions' },
            { status: 500 }
          );
        }
      }
    }

    logAudit(auth.userId, {
      action: 'update',
      resourceType: 'role',
      resourceId: body.role_id,
      details: {
        role_name: role.name,
        permissions: body.permissions,
      },
    });

    return NextResponse.json({
      success: true,
      role_id: body.role_id,
      permissions_set: body.permissions.length,
    });
  } catch (err) {
    logger.error('admin_roles_update_failed', { error: err instanceof Error ? err : new Error(String(err)), route: '/api/v1/admin/roles' });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
