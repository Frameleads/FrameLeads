import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(req: Request) {
  try {
    // 1. Basic Admin Key Authentication
    const authHeader = req.headers.get('x-admin-key');
    if (authHeader !== process.env.ADMIN_SECRET_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const whopApiKey = process.env.WHOP_API_KEY;
    if (!whopApiKey) {
      return NextResponse.json({ error: 'WHOP_API_KEY is not set on the server' }, { status: 500 });
    }

    // 2. Fetch memberships from Whop (Paginated)
    let hasMore = true;
    let pageNumber = 1;
    let memberships: any[] = [];

    while (hasMore) {
      const res = await fetch(`https://api.whop.com/api/v2/memberships?page=${pageNumber}&limit=50`, {
        headers: {
          'Authorization': `Bearer ${whopApiKey}`,
          'Accept': 'application/json'
        }
      });

      if (!res.ok) {
        const errorText = await res.text();
        return NextResponse.json({ error: `Whop API Error: ${res.status} ${errorText}` }, { status: res.status });
      }

      const data = await res.json();
      const items = data.data || [];
      
      memberships.push(...items);

      if (items.length < 50) {
        hasMore = false;
      } else {
        pageNumber++;
      }
    }

    // 3. Process Memberships
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;

    for (const membership of memberships) {
      try {
        const whopUserId = membership.user?.id || membership.user_id;
        const email = membership.user?.email || membership.email;
        const status = membership.status || membership.state; // handle different api versions
        
        const stringified = JSON.stringify(membership).toLowerCase();

        if (!whopUserId && !email) {
          skipped++;
          continue;
        }

        const where = email ? { email } : { whopId: whopUserId };

        if (status === 'active' || status === 'valid') {
          let assignedTier = 'FREE'; 
          let assignedQuota = 0;
          
          if (/\bmicro\b/.test(stringified)) { 
              assignedTier = 'MICRO_PILOT'; 
              assignedQuota = 25; 
          } else if (/\benterprise\b/.test(stringified)) { 
              assignedTier = 'ENTERPRISE'; 
              assignedQuota = 20000; 
          } else if (/\bcore\b/.test(stringified)) { 
              assignedTier = 'CORE'; 
              assignedQuota = 500; 
          }

          const existingUser = await prisma.user.findFirst({ where });
          
          await prisma.user.upsert({
            where: where,
            update: { tier: assignedTier, monthlyQuota: assignedQuota }, // Do not reset leadsProcessed
            create: {
              whopId: whopUserId || `missing_${Date.now()}`,
              email: email || `missing_${whopUserId || Date.now()}@whop.local`, 
              tier: assignedTier, 
              monthlyQuota: assignedQuota, 
              leadsProcessed: 0 
            }
          });

          if (existingUser) updated++; else created++;
          
        } else {
          const existingUser = await prisma.user.findFirst({ where });
          if (existingUser && existingUser.tier !== 'FREE') {
            await prisma.user.updateMany({
              where: where,
              data: { tier: 'FREE', monthlyQuota: 0 }
            });
            updated++;
          } else {
            skipped++;
          }
        }
      } catch (err) {
        console.error('Error syncing membership:', err);
        errors++;
      }
    }

    return NextResponse.json({
      success: true,
      stats: {
        total_memberships_fetched: memberships.length,
        created,
        updated,
        skipped,
        errors
      }
    });

  } catch (error: any) {
    console.error('Whop sync error:', error);
    return NextResponse.json({ error: error.message || 'Internal error' }, { status: 500 });
  }
}
