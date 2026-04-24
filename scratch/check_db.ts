import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Ошибка: Отсутствуют переменные окружения в .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkConnection() {
  console.log('📡 Проверка подключения к Supabase...');
  
  const { data: projects, error } = await supabase
    .from('projects')
    .select('*')
    .limit(1);

  if (error) {
    console.error('❌ Ошибка при запросе к таблице projects:', error.message);
    if (error.message.includes('relation "projects" does not exist')) {
        console.log('💡 Таблица projects еще не создана. Нужно запустить миграции.');
    }
  } else {
    console.log('✅ Подключение успешно! Найдено проектов:', projects.length);
  }

  const { data: profiles, error: pError } = await supabase
    .from('profiles')
    .select('*')
    .limit(1);

  if (pError) {
    console.error('❌ Ошибка при запросе к таблице profiles:', pError.message);
  } else {
    console.log('✅ Таблица profiles доступна. Найдено профилей:', profiles.length);
  }
}

checkConnection();
