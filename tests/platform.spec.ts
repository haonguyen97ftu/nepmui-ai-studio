import { expect,test } from '@playwright/test'
import {mkdir} from 'node:fs/promises'

async function shot(page:import('@playwright/test').Page,name:string) {
  await mkdir('test-results/screenshots',{recursive:true})
  await page.screenshot({path:'test-results/screenshots/platform-'+name+'.png',fullPage:true,animations:'disabled'})
}
test('creates a workspace, configures an agent and mock Page, and manages a member',async({page},info)=>{
  const mobile=info.project.name==='iphone',name='Synthetic UI '+info.project.name
  await page.goto('/#platform')
  await expect(page.getByRole('heading',{name:'Tổng quan nền tảng'})).toBeVisible()
  await expect(page.locator('.logo').getByText('AI Studio',{exact:true})).toHaveCount(1)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBe(0)
  await shot(page,'overview-'+info.project.name)
  await page.getByRole('button',{name:'Tạo không gian',exact:true}).click()
  const form=page.getByRole('form',{name:'Tạo không gian'})
  await form.getByLabel('Tên thương hiệu').fill(name)
  await form.getByRole('button',{name:'Tiếp tục',exact:true}).click()
  await expect(form.getByRole('heading',{name})).toBeVisible()
  await form.getByRole('button',{name:'Tạo không gian',exact:true}).click()
  const row=page.getByRole('row').filter({hasText:name})
  await expect(row).toBeVisible()
  await row.getByRole('button',{name:'Mở',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Tổng quan',exact:true})).toBeVisible()
  await expect(page.getByLabel('Chọn không gian làm việc')).toHaveValue(/.{36}/)
  await expect(page.locator('.workspace-heading')).toContainText(name)
  await page.goto('/#agents')
  await page.getByRole('button',{name:'Tạo trợ lý',exact:true}).click()
  await page.getByLabel('Tên trợ lý').fill('Trợ lý tổng hợp')
  await page.getByLabel('Giọng điệu',{exact:true}).fill('Ngắn gọn, thân thiện')
  await page.getByRole('button',{name:'Lưu trợ lý',exact:true}).click()
  await expect(page.getByText('Đã lưu trợ lý.',{exact:true})).toBeVisible()
  await shot(page,'agents-'+info.project.name)
  await page.goto('/#channels')
  await page.getByRole('button',{name:'Kết nối kênh',exact:true}).click()
  await page.getByLabel('Tên hiển thị').fill('Page tổng hợp UI')
  await page.getByLabel('Page / tài khoản / widget ID').fill(mobile?'666002':'666001')
  await page.getByLabel('Trợ lý mặc định').selectOption({label:'Trợ lý tổng hợp'})
  await page.getByLabel('Tạm dừng xử lý').uncheck()
  await page.getByRole('button',{name:'Lưu kênh',exact:true}).click()
  await expect(page.getByText('Đã lưu cấu hình kênh.',{exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Thử Page',exact:true}).click()
  await page.getByLabel('Câu hỏi tổng hợp').fill('Câu hỏi tổng hợp chưa có nguồn')
  await page.getByRole('button',{name:'Gửi sự kiện mô phỏng',exact:true}).click()
  await expect(page.getByText('Đã tiếp nhận sự kiện mô phỏng.',{exact:false})).toBeVisible()
  await shot(page,'channels-'+info.project.name)
  await page.goto('/#users')
  await page.getByRole('button',{name:'Thêm thành viên',exact:true}).click()
  await page.getByLabel('Họ tên',{exact:true}).fill('Viewer tổng hợp '+info.project.name)
  await page.getByLabel('Email',{exact:true}).fill('viewer-ui-'+info.project.name+'@example.test')
  await page.getByLabel('Mật khẩu ban đầu').fill('Synthetic-ui-password-04!')
  await page.getByRole('button',{name:'Tạo thành viên',exact:true}).click()
  await expect(page.getByText('Đã tạo tài khoản và quyền trong không gian này.')).toBeVisible()
  await expect(page.getByLabel('Vai trò của Viewer tổng hợp '+info.project.name)).toHaveValue('viewer')
  await shot(page,'team-'+info.project.name)
  // A separate browser login demonstrates that the UI does not expose admin controls to a Viewer.
  const response=await page.request.post('/api/session',{headers:{Origin:new URL(page.url()).origin},data:{email:'viewer-ui-'+info.project.name+'@example.test',password:'Synthetic-ui-password-04!'}})
  expect(response.status()).toBe(200)
  await page.goto('/#knowledge')
  await page.reload()
  await expect(page.getByText('Bạn đang xem ở chế độ chỉ đọc.')).toBeVisible()
  await page.goto('/#users')
  await expect(page.getByRole('heading',{name:'Không có quyền truy cập'})).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBe(0)
})

test('keeps workspace data and navigation within the viewport at four responsive widths',async({page},info)=>{
  test.skip(info.project.name!=='desktop','Viewport coverage runs once.')
  for (const width of [320,768,1024,1440]) {
    await page.setViewportSize({width,height:1000})
    await page.goto('/#platform')
    await expect(page.getByRole('heading',{name:'Tổng quan nền tảng'})).toBeVisible()
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBe(0)
    await page.getByRole('button',{name:'Tạo không gian',exact:true}).focus()
    await expect(page.getByRole('button',{name:'Tạo không gian',exact:true})).toBeFocused()
    await shot(page,'responsive-'+width)
  }
})

test('limits an unclaimed founder session to setup and reaches account-based administration',async({page},info)=>{
  const {runtime}=await import('../scripts/runtime.mjs')
  const secret='synthetic-browser-bootstrap-key-041'
  const instance=await runtime({ADMIN_SECRET:secret,AUTH_PEPPER:'f'.repeat(64)})
  try {
    await page.goto(String(instance.url))
    await page.getByRole('button',{name:'Thiết lập nhà sáng lập lần đầu'}).click()
    await page.getByLabel('Khóa nhà sáng lập').fill(secret)
    await page.getByRole('button',{name:'Đăng nhập',exact:true}).click()
    await expect(page.getByRole('heading',{name:'Thiết lập tài khoản nhà sáng lập'})).toBeVisible()
    await expect(page.locator('nav')).toHaveCount(0)
    await expect(page.getByLabel('Chọn không gian làm việc')).toHaveCount(0)
    await page.getByLabel('Tên quản trị viên').fill('Synthetic Browser Founder')
    await page.getByLabel('Email tài khoản').fill('browser-founder@example.test')
    await page.getByLabel('Mật khẩu mới').fill('Synthetic-browser-founder-password!')
    await page.getByRole('button',{name:'Tạo tài khoản nhà sáng lập'}).click()
    await expect(page.getByRole('heading',{name:'Tổng quan',exact:true})).toBeVisible()
    if (info.project.name==='iphone') await page.getByRole('button',{name:'Mở menu',exact:true}).click()
    await expect(page.getByRole('navigation').getByRole('link',{name:'Nền tảng',exact:true})).toBeVisible()
  } finally {await instance.app.dispose()}
})

test('renders initials without fetching configured workspace logos', async ({ page }, info) => {
  const logo = 'https://workspace-logo.example.test/synthetic.png'
  const name = 'Logo privacy ' + info.project.name
  const requests: string[] = []
  await page.route('https://workspace-logo.example.test/**', async route => {
    requests.push(route.request().url())
    await route.abort()
  })
  const home = await page.goto('/#platform')
  expect(home?.headers()['content-security-policy']).toMatch(/(?:^|; )img-src 'self';/)
  const response = await page.request.post('/api/workspaces', {
    headers: { Origin: new URL(page.url()).origin }, data: { name, logo },
  })
  expect(response.ok()).toBe(true)
  await page.reload()
  const row = page.getByRole('row').filter({ hasText: name })
  await expect(row.locator('.workspace-avatar')).toHaveText('L')
  await expect(row.locator('img')).toHaveCount(0)
  await row.getByRole('button', { name: 'Mở', exact: true }).click()
  const header = page.locator('.workspace-heading')
  await expect(header).toContainText(name)
  await expect(header.locator('.workspace-avatar')).toHaveText('L')
  await expect(header.locator('img')).toHaveCount(0)
  expect(requests).toEqual([])
})
