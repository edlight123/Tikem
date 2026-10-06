import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/firebase-db/server'
import { requireDevTools } from '@/lib/auth'
import { adminError, adminOk } from '@/lib/api/admin-response'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { user, error } = await requireDevTools()
    if (error || !user) {
      return adminError(error || 'Unauthorized', error === 'Not authenticated' ? 401 : 403)
    }

    const supabase = await createClient()

    // Get user data directly by ID
    const { data: userById, error: userByIdError } = await supabase
      .from('users')
      .select('*')
      .eq('id', user.id)

    // Also get all users and find
    const allUsers = await supabase.from('users').select('*')
    const userByFind = allUsers.data?.find((u: any) => u.id === user.id)

    return adminOk({
      authUserId: user.id,
      authUserEmail: user.email,
      userByIdQuery: userById || null,
      userByIdError: userByIdError ? userByIdError.message : null,
      userByFind: userByFind || null,
      allUsersCount: allUsers.data?.length || 0,
    })
  } catch (err: any) {
    return adminError('Internal server error', 500, err?.message || String(err))
  }
}
