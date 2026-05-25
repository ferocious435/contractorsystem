
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseKey)

async function check() {
    const { data: projects, error: pError } = await supabase.from('projects').select('*').limit(5)
    if (pError) {
        console.error('Projects Error:', pError)
    } else {
        console.log('Projects:', JSON.stringify(projects, null, 2))
    }

    const { data: authUsers, error: aError } = await supabase.auth.admin.listUsers()
    if (aError) {
        console.error('Users Error:', aError)
    } else {
        console.log('Users:', authUsers.users.map(u => ({ id: u.id, email: u.email })))
    }
}

check()
