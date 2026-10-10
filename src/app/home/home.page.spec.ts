import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular/lazy';
import { of, Subject, throwError } from 'rxjs';

import { HomePage } from './home.page';
import { PosApiService } from '../services/pos-api.service';

describe('HomePage', () => {
  let component: HomePage;
  let fixture: ComponentFixture<HomePage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [HomePage],
      imports: [IonicModule.forRoot(), FormsModule]
    }).compileComponents();

    fixture = TestBed.createComponent(HomePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('provides four phone destinations and keeps secondary tools in More', () => {
    component.loggedIn = true;
    component.moreMenuOpen = true;
    fixture.detectChanges();
    const nav = fixture.nativeElement.querySelector('.mobile-nav');
    expect(Array.from(nav.querySelectorAll('button')).map((button: any) => button.textContent.trim())).toEqual(['Sale', 'Wallet', 'Loyalty', 'More']);
    const tools = fixture.nativeElement.querySelector('.mobile-menu');
    expect(tools.textContent).toContain('Transactions');
    expect(tools.textContent).toContain('Staff');
    expect(tools.textContent).toContain('Sign out');
  });

  it('closes More after navigation without losing the basket', () => {
    component.moreMenuOpen = true;
    component.catalog = [{ id: 'TEA', name: 'Tea', description: '', category: 'Drink', price: 5.9, active: true }];
    component.staffRecords = [{ StaffName: 'Synthetic staff' }];
    component.addToCart(component.catalog[0]);
    component.selectTab('loyalty');
    expect(component.moreMenuOpen).toBe(false);
    expect(component.moreTabActive).toBe(false);
    expect(component.cartCount).toBe(1);
    component.selectTab('members');
    expect(component.moreTabActive).toBe(true);
  });

  it('keeps the phone basket action disabled until an item is selected', () => {
    component.loggedIn = true;
    component.saleStep = 'products';
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.mobile-order-bar ion-button').disabled).toBe(true);
    component.addToCart({ id: 'TEA', name: 'Tea', description: '', category: 'Drink', price: 5.9, active: true });
    (component as any).changeDetector.detectChanges();
    const basket = fixture.nativeElement.querySelector('.mobile-order-bar');
    expect(basket.textContent).toContain('RM 5.90');
    expect(basket.querySelector('ion-button').disabled).toBe(false);
    component.cameraActive = true;
    (component as any).changeDetector.detectChanges();
    expect(fixture.nativeElement.querySelector('.mobile-order-bar')).toBeNull();
  });

  it('shows the Swagger stamp redemption count and claim date in history', () => {
    vi.spyOn(TestBed.inject(PosApiService), 'history').mockReturnValue(of([
      { ReferenceNumber: 'SALE-TEST', TotalUseStamp: 3, ClaimDate: '2026-10-09T19:54:39' }
    ]));
    component.historyType = 'stamps';
    component.loadHistory();
    expect(component.historyRecords[0]).toEqual(expect.objectContaining({
      Amount: '3 stamps redeemed', Status: 'Redeemed', DateTime: '2026-10-09T19:54:39'
    }));
  });

  it('does not create or credit a top-up when payment confirmation is cancelled', async () => {
    const action = vi.spyOn(TestBed.inject(PosApiService), 'action');
    vi.spyOn(component as any, 'confirmAction').mockResolvedValue(false);
    component.member = { FullName: 'Test member', PhoneNumber: '+60123456789' };
    component.staffName = 'Test staff';
    component.staffPassword = 'test-pin';
    component.topupAmount = 100;
    await component.topup();
    expect(action).not.toHaveBeenCalled();
  });

  it('reads the official point-history member and date fields', () => {
    vi.spyOn(TestBed.inject(PosApiService), 'history').mockReturnValue(of([{ MemberPhone: '+601298989899', DateAssign: '2026-10-09T19:59:19', Point: 200 }]));
    component.historyType = 'points';
    component.loadHistory();
    expect(component.historyRecords[0].PhoneNumber).toBe('+601298989899');
    expect(component.historyRecords[0].Status).toBe('Points awarded');
    expect(component.historyDate(component.historyRecords[0])).toBeInstanceOf(Date);
    component.loggedIn = true;
    component.tab = 'history';
    (component as any).changeDetector.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('+601298989899');
    expect(fixture.nativeElement.textContent).toContain('Points awarded');
  });

  it('does not send missing or invalid dates to the date pipe', () => {
    expect(component.historyDate({})).toBeNull();
    expect(component.historyDate({ DateTime: '—' })).toBeNull();
    expect(component.historyDate({ DateTime: '—', DateAssign: '2026-10-09T19:59:19' })).toBeInstanceOf(Date);
    component.loggedIn = true;
    component.tab = 'history';
    component.historyRecords = [{ Id: 1, DateTime: '—' }];
    expect(() => (component as any).changeDetector.detectChanges()).not.toThrow();
  });

  it('waits for confirmed credit and applies the returned wallet balance', async () => {
    const api = TestBed.inject(PosApiService);
    const action = vi.spyOn(api, 'action').mockReturnValue(of({ Status: 'Paid', IsPaid: 'Paid', wallet: { Balance: 100 } }));
    vi.spyOn(api, 'scanMember').mockReturnValue(of({ FullName: 'Test member', PhoneNumber: '+60123456789', Balance: 100 }));
    vi.spyOn(component as any, 'confirmAction').mockResolvedValue(true);
    component.member = { FullName: 'Test member', PhoneNumber: '+60123456789', Balance: 0 };
    component.staffName = 'Test staff';
    component.staffPassword = 'test-pin';
    component.topupAmount = 100;
    await component.topup();
    expect(action).toHaveBeenCalledExactlyOnceWith('topup', expect.objectContaining({ paymentReceived: true, TopupAmount: 100 }));
    expect(component.member.Balance).toBe(100);
  });

  it('parses a secure member QR payload', () => {
    const parsed = (component as any).parseQr(JSON.stringify({
      type: 'LOYALTY_MEMBER', phoneNumber: '+601298989899', verificationToken: 'signed-token'
    }));
    expect(parsed).toEqual({ type: 'LOYALTY_MEMBER', phone: '+601298989899', rewardId: '', verificationToken: 'signed-token' });
  });

  it('parses a secure reward QR payload', () => {
    const parsed = (component as any).parseQr(JSON.stringify({
      type: 'LOYALTY_REWARD', phoneNumber: '+601298989899', rewardId: 'Reward-1', verificationToken: 'signed-token'
    }));
    expect(parsed).toEqual({ type: 'LOYALTY_REWARD', phone: '+601298989899', rewardId: 'Reward-1', verificationToken: 'signed-token' });
  });

  it('parses the compact mobile member QR payload', () => {
    const parsed = (component as any).parseQr(JSON.stringify({
      t: 'M', p: '+601298989899', v: 'signed-token'
    }));
    expect(parsed).toEqual({ type: 'LOYALTY_MEMBER', phone: '+601298989899', rewardId: '', verificationToken: 'signed-token' });
  });

  it('automatically looks up the member when the camera decodes a QR', async () => {
    const qrToken = 'm_p601298989899_hrz7f_l4jSfXXvjysi';
    component.loggedIn = true;
    component.scannerVideo = { nativeElement: document.createElement('video') } as any;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn() }
    });
    const api = TestBed.inject(PosApiService);
    const scanMember = vi.spyOn(api, 'scanMember').mockReturnValue(of({
      FullName: 'Lee', Phone: '+601298989899', Balance: 0, Point: 0, AccountStatus: 'active'
    }));
    vi.spyOn((component as any).qrReader, 'decodeFromConstraints').mockImplementation(async (_constraints: any, _video: any, callback: any) => {
      callback({ getText: () => qrToken });
      return { stop: vi.fn(), switchTorch: vi.fn() };
    });

    await component.startCamera();
    await new Promise(resolve => window.setTimeout(resolve, 0));

    fixture.detectChanges();
    expect(scanMember).toHaveBeenCalledWith('', qrToken);
    expect(component.member.FullName).toBe('Lee');
    expect(fixture.nativeElement.textContent).toContain('Lee');
  });

  it('builds a basket from API catalogue products and calculates the total', () => {
    component.addToCart({ id: 'DRINK-LATTE', name: 'Caffè Latte', description: 'Coffee', category: 'Coffee', price: 9.9, active: true });
    component.addToCart({ id: 'DRINK-LATTE', name: 'Caffè Latte', description: 'Coffee', category: 'Coffee', price: 9.9, active: true });
    component.addToCart({ id: 'FOOD-CROISSANT', name: 'Butter Croissant', description: 'Pastry', category: 'Pastries', price: 7.5, active: true });

    expect(component.cartCount).toBe(3);
    expect(component.subtotal).toBeCloseTo(27.3, 2);
  });

  it('preserves the payment reference after errors and ignores repeated clicks while busy', () => {
    const api = TestBed.inject(PosApiService);
    const pending = new Subject<any>();
    const checkout = vi.spyOn(api, 'checkout').mockReturnValue(pending);
    component.member = { PhoneNumber: '+601298989899' };
    component.staffName = 'Tim';
    component.staffPassword = 'staff-password';
    component.cart = [{ id: 'TEA', name: 'Tea', description: '', category: 'Drink', price: 5.9, active: true, quantity: 1 }];
    component.completeSale();
    const reference = component.referenceNumber;
    component.completeSale();
    expect(checkout).toHaveBeenCalledTimes(1);
    pending.error({ error: { message: 'Request interrupted' } });
    checkout.mockReturnValue(throwError(() => ({ error: { message: 'Already recorded' } })));
    component.completeSale();
    expect(checkout.mock.calls[1][0]['referenceNumber']).toBe(reference);
    expect(component.saleStep).not.toBe('complete');
  });

  it('shows a reversal warning instead of claiming the wallet was refunded', async () => {
    vi.spyOn(component as any, 'confirmAction').mockResolvedValue(true);
    vi.spyOn(TestBed.inject(PosApiService), 'action').mockReturnValue(of({ warning: 'Wallet refund was not confirmed.' }));
    vi.spyOn(component, 'loadHistory').mockImplementation(() => {});
    const notify = vi.spyOn(component as any, 'notify').mockResolvedValue(undefined);
    component.historyType = 'spends';
    await component.voidRecord({ SpendId: 'Spend-1' });
    expect(notify).toHaveBeenCalledWith('Wallet refund was not confirmed.', 'warning', 8000);
  });

  it('clearly warns when a void does not restore the wallet balance', async () => {
    vi.spyOn(component as any, 'confirmAction').mockResolvedValue(true);
    vi.spyOn(TestBed.inject(PosApiService), 'action').mockReturnValue(of({ walletRefundConfirmed: false }));
    vi.spyOn(component, 'loadHistory').mockImplementation(() => {});
    vi.spyOn(component as any, 'refreshMember').mockImplementation(() => {});
    const notify = vi.spyOn(component as any, 'notify').mockResolvedValue(undefined);
    component.historyType = 'spends';
    await component.voidRecord({ SpendId: 'Spend-1' });
    expect(notify).toHaveBeenCalledWith(
      'Purchase voided. The wallet balance has not been restored. Check any stamps awarded separately.',
      'warning', 8000
    );
  });

  it('does not void a transaction when its dialog is cancelled', async () => {
    vi.spyOn(component as any, 'confirmAction').mockResolvedValue(false);
    const action = vi.spyOn(TestBed.inject(PosApiService), 'action');
    component.historyType = 'spends';
    await component.voidRecord({ SpendId: 'Spend-1' });
    expect(action).not.toHaveBeenCalled();
  });

  it('submits the reason entered in the top-up void dialog', async () => {
    vi.spyOn(component as any, 'confirmAction').mockResolvedValue('Duplicate receipt');
    const action = vi.spyOn(TestBed.inject(PosApiService), 'action').mockReturnValue(of({}));
    vi.spyOn(component, 'loadHistory').mockImplementation(() => {});
    vi.spyOn(component as any, 'notify').mockResolvedValue(undefined);
    component.historyType = 'topups';
    await component.voidRecord({ TopupId: 'Topup-1' });
    expect(action).toHaveBeenCalledWith('void-topup', { TopupId: 'Topup-1', VoidDescription: 'Duplicate receipt' });
  });

  it('submits product identifiers and advances to the completed sale', () => {
    const api = TestBed.inject(PosApiService);
    const checkout = vi.spyOn(api, 'checkout').mockReturnValue(of({
      referenceNumber: 'SALE-1', grandAmount: 9.9, paymentMethod: 'Cash', items: [], pointsAwarded: 9, stampsAwarded: 1
    }));
    vi.spyOn(api, 'scanMember').mockReturnValue(of({ FullName: 'Lee', PhoneNumber: '+601298989899', Point: 9, TotalStamp: 1 }));
    component.member = { FullName: 'Lee', PhoneNumber: '+601298989899' };
    component.staffName = 'HongTesting01';
    component.staffPassword = '1234';
    component.cart = [{ id: 'DRINK-LATTE', name: 'Caffè Latte', description: 'Coffee', category: 'Coffee', price: 9.9, active: true, quantity: 1 }];

    component.completeSale();

    expect(checkout).toHaveBeenCalledWith(expect.objectContaining({
      phoneNumber: '+601298989899', items: [{ productId: 'DRINK-LATTE', quantity: 1 }]
    }));
    expect(component.saleStep).toBe('complete');
  });
});
