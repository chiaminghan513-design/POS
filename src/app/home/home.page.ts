import { ChangeDetectorRef, Component, ElementRef, NgZone, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { AlertController, ToastController } from '@ionic/angular';
import { BrowserQRCodeReader, IScannerControls } from '@zxing/browser';
import { PosApiService } from '../services/pos-api.service';

type PosTab = 'sale' | 'topup' | 'loyalty' | 'members' | 'history' | 'notify' | 'staff' | 'eod';
type SaleStep = 'member' | 'products' | 'review' | 'payment' | 'complete';
type CatalogProduct = { id: string; name: string; description: string; category: string; price: number; active: boolean };
type CartLine = CatalogProduct & { quantity: number };

@Component({ selector: 'app-home', templateUrl: 'home.page.html', styleUrls: ['home.page.scss'], standalone: false })
export class HomePage implements OnInit, OnDestroy {
  @ViewChild('scannerVideo') scannerVideo?: ElementRef<HTMLVideoElement>;
  loggedIn = Boolean(localStorage.getItem('pos_token'));
  busy = false;
  tab: PosTab = 'sale';
  moreMenuOpen = false;
  lookupExpanded = false;
  merchantId = localStorage.getItem('pos_merchant_id') || '';
  merchantPassword = '';
  merchantName = localStorage.getItem('pos_merchant_name') || 'Eduvo Merchant';
  scanValue = '';
  memberVerificationToken = '';
  rewardVerificationToken = '';
  member: any = null;
  staffName = '';
  staffPassword = '';
  amount = 0;
  discountAmount = 0;
  stampUseCount = 0;
  paymentMethod: 'Cash' | 'Wallet' = 'Cash';
  referenceNumber = '';
  topupAmount = 0;
  topupDescription = '';
  pointAmount = 0;
  pointDescription = '';
  stampAmount = 1;
  purchaseAmount = 0;
  rewardId = '';
  stampRecords: any[] = [];
  historyType = 'spends';
  memberOnlyHistory = false;
  historyRecords: any[] = [];
  transactionDetail: any = null;
  staffRecords: any[] = [];
  staffForm = { staffName: '', staffType: 'Staff', phoneNumber: '', password: '' };
  eodDate = new Date().toISOString().slice(0, 10);
  eodResult: any = null;
  lastReceipt: any = null;
  cameraActive = false;
  cameraMessage = '';
  private scanHandled = false;
  private readonly qrReader = new BrowserQRCodeReader();
  private scannerControls?: IScannerControls;
  private readonly api = inject(PosApiService);
  private readonly toasts = inject(ToastController);
  private readonly alerts = inject(AlertController);
  private confirmationOpen = false;
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly zone = inject(NgZone);
  registration = { Name: '', Email: '', PhoneNumber: '', BirthDate: '', ReferralBy: '', Password: '' };
  notificationAudience: 'member' | 'all' = 'member';
  notificationTitle = '';
  notificationBody = '';
  saleStep: SaleStep = 'member';
  catalog: CatalogProduct[] = [];
  selectedCategory = 'All';
  cart: CartLine[] = [];
  checkoutResult: any = null;

  ngOnInit() {
    if (!this.loggedIn) return;
    this.api.validateSession().subscribe({
      next: session => {
        if (!session.valid || session.merchantId !== this.merchantId) this.expireSession();
        else {
          this.loadStaff(false);
          this.loadCatalog(false);
        }
      },
      error: () => this.expireSession()
    });
  }

  ngOnDestroy() { this.stopCamera(); }

  login() {
    if (!this.merchantId.trim() || !this.merchantPassword) return void this.notify('Enter your merchant ID and password.', 'warning');
    this.run(this.api.login(this.merchantId.trim(), this.merchantPassword), result => {
      const profile = this.first(result.profile);
      localStorage.setItem('pos_token', result.sessionToken);
      localStorage.setItem('pos_merchant_id', result.merchantId);
      this.merchantName = profile.Name || profile.MerchantName || profile.CompanyName || result.merchantId;
      localStorage.setItem('pos_merchant_name', this.merchantName);
      this.loggedIn = true;
      this.merchantPassword = '';
      this.loadStaff(false);
      this.loadCatalog(false);
    }, 'Counter opened.');
  }

  logout() {
    this.moreMenuOpen = false; this.lookupExpanded = false;
    this.stopCamera();
    localStorage.removeItem('pos_token'); localStorage.removeItem('pos_merchant_id'); localStorage.removeItem('pos_merchant_name');
    this.loggedIn = false; this.member = null; this.merchantPassword = '';
    this.staffRecords = []; this.staffName = ''; this.staffPassword = '';
  }

  scanMember(scannedValue?: string) {
    const value = typeof scannedValue === 'string' ? scannedValue : this.scanValue;
    const parsed = this.parseQr(value);
    this.memberVerificationToken = parsed.type === 'LOYALTY_MEMBER' ? parsed.verificationToken : '';
    if (parsed.rewardId) {
      this.rewardId = parsed.rewardId;
      this.rewardVerificationToken = parsed.verificationToken;
      this.tab = 'loyalty';
    }
    if (!parsed.phone && !parsed.verificationToken) return void this.notify('Scan the member QR or enter a valid phone number.', 'warning');
    this.lookupMember(parsed.phone, this.memberVerificationToken);
  }

  async startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) return void this.notify('Camera scanning is not supported in this browser. Paste the QR text instead.', 'warning');
    try {
      this.scanHandled = false;
      this.cameraMessage = 'Starting camera…';
      this.cameraActive = true;
      this.changeDetector.detectChanges();
      const video = this.scannerVideo?.nativeElement;
      if (!video) throw new Error('Scanner preview was not created.');
      this.scannerControls = await this.qrReader.decodeFromConstraints({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false
      }, video, result => {
        if (!result || this.scanHandled) return;
        this.scanHandled = true;
        const decodedValue = result.getText();
        this.zone.run(() => {
          this.scanValue = decodedValue;
          this.cameraMessage = 'QR recognised. Loading member…';
          this.stopCamera();
          window.setTimeout(() => this.zone.run(() => this.scanMember(decodedValue)), 0);
        });
      });
      void this.tuneCamera(video);
      this.cameraMessage = 'Point the camera at the QR shown in the Eduvo member app.';
    } catch {
      this.stopCamera();
      void this.notify('The camera could not be opened. Allow camera access, or enter the member phone number manually.', 'warning');
    }
  }

  stopCamera() {
    try { this.scannerControls?.stop(); } catch { /* Lookup must not be blocked by scanner cleanup. */ }
    this.scannerControls = undefined;
    try {
      const stream = this.scannerVideo?.nativeElement.srcObject;
      if (typeof MediaStream !== 'undefined' && stream instanceof MediaStream) stream.getTracks().forEach(track => track.stop());
    } catch { /* Camera tracks may already be closed by the QR reader. */ }
    this.cameraActive = false;
    try { this.changeDetector.detectChanges(); } catch { /* Component may already be changing views. */ }
  }

  private async tuneCamera(video: HTMLVideoElement) {
    try {
      const stream = video.srcObject;
      if (!(stream instanceof MediaStream)) return;
      const track = stream.getVideoTracks()[0];
      const capabilities = track.getCapabilities() as MediaTrackCapabilities & { focusMode?: string[]; zoom?: { min: number; max: number } };
      const advanced: Record<string, unknown> = {};
      if (capabilities.focusMode?.includes('continuous')) advanced['focusMode'] = 'continuous';
      if (capabilities.zoom) advanced['zoom'] = Math.min(capabilities.zoom.max, Math.max(capabilities.zoom.min, 1.5));
      if (Object.keys(advanced).length) await track.applyConstraints({ advanced: [advanced] as MediaTrackConstraintSet[] });
    } catch {
      // Some webcams expose focus/zoom capabilities but reject manual constraints.
    }
  }

  registerMember() {
    const value = this.registration;
    if (!value.Name.trim() || !value.Email.trim() || !value.PhoneNumber.trim()) return void this.notify('Name, email, and phone number are required.', 'warning');
    this.run(this.api.registerMember(value), () => {
      const phone = value.PhoneNumber;
      this.registration = { Name: '', Email: '', PhoneNumber: '', BirthDate: '', ReferralBy: '', Password: '' };
      this.lookupMember(phone);
      this.tab = 'sale';
    }, 'Member account created.');
  }

  completeSale() {
    if (this.busy || !this.requireMemberAndStaff() || !this.cart.length) return;
    // Preserve the reference on failure so a retry cannot create another charge.
    const reference = this.referenceNumber ||= this.reference('SALE');
    const body = {
      phoneNumber: this.phone,
      items: this.cart.map(item => ({ productId: item.id, quantity: item.quantity })),
      discountAmount: this.discountAmount,
      stampUseCount: this.stampUseCount,
      paymentMethod: this.paymentMethod,
      referenceNumber: reference,
      staffName: this.staffName,
      staffPassword: this.staffPassword,
    };
    this.run(this.api.checkout(body), result => {
      this.checkoutResult = result;
      this.lastReceipt = { type: 'SALE RECEIPT', reference: result.referenceNumber || reference, member: this.memberName, phone: this.phone, amount: result.grandAmount, payment: result.paymentMethod, date: new Date(), items: result.items, pointsAwarded: result.pointsAwarded, stampsAwarded: result.stampsAwarded, result };
      this.saleStep = 'complete';
      if (result.member) this.member = this.first(result.member);
      this.refreshMember();
      void this.notify(result.loyaltyWarning || 'Payment completed and member rewards updated.', result.loyaltyWarning ? 'warning' : 'success');
    });
  }

  loadCatalog(showErrors = true) {
    const source = this.api.catalog();
    if (showErrors) {
      this.run(source, result => this.catalog = this.list(result));
      return;
    }
    source.subscribe({ next: result => this.catalog = this.list(result) });
  }

  addToCart(product: CatalogProduct) {
    const existing = this.cart.find(item => item.id === product.id);
    if (existing) existing.quantity += 1;
    else this.cart.push({ ...product, quantity: 1 });
  }

  changeQuantity(productId: string, delta: number) {
    const item = this.cart.find(line => line.id === productId);
    if (!item) return;
    item.quantity += delta;
    if (item.quantity <= 0) this.cart = this.cart.filter(line => line.id !== productId);
  }

  goToSaleStep(step: SaleStep) {
    if (step !== 'member' && !this.member) return void this.notify('Select a member before building the order.', 'warning');
    if ((step === 'review' || step === 'payment') && !this.cart.length) return void this.notify('Add at least one item to the order.', 'warning');
    this.saleStep = step;
  }

  newSale() {
    this.member = null;
    this.scanValue = '';
    this.cart = [];
    this.discountAmount = 0;
    this.stampUseCount = 0;
    this.paymentMethod = 'Cash';
    this.referenceNumber = '';
    this.staffPassword = '';
    this.checkoutResult = null;
    this.saleStep = 'member';
  }

  async topup() {
    if (this.busy || !this.requireMemberAndStaff() || !Number.isFinite(Number(this.topupAmount)) || this.topupAmount <= 0) return;
    if (!await this.confirmAction('Confirm wallet top-up', `Confirm that RM ${Number(this.topupAmount).toFixed(2)} has been received from ${this.memberName}. This will credit their Eduvo wallet.`, 'Confirm top-up')) return;
    if (this.busy || !this.requireMemberAndStaff()) return;
    const reference = this.referenceNumber || this.reference('TOPUP');
    this.referenceNumber = reference;
    this.run(this.api.action('topup', { paymentReceived: true, Description: this.topupDescription || 'Counter wallet top-up', TopupAmount: this.topupAmount, PhoneNumber: this.phone, PaymentMethod: this.paymentMethod, ReferenceNumber: reference, StaffName: this.staffName, StaffPassword: this.staffPassword }), result => {
      this.lastReceipt = { type: 'TOP-UP RECEIPT', reference, member: this.memberName, phone: this.phone, amount: this.topupAmount, payment: this.paymentMethod, date: new Date(), result };
      if (result.wallet) this.member = { ...this.member, ...this.first(result.wallet) };
      this.referenceNumber = '';
      this.refreshMember();
    }, `Wallet topped up by RM ${this.topupAmount.toFixed(2)}`);
  }

  assignPoints() {
    if (!this.requireMemberAndStaff() || this.pointAmount <= 0) return;
    this.run(this.api.action('points', { PhoneNumber: this.phone, Point: this.pointAmount, Description: this.pointDescription || 'Counter bonus points', StaffName: this.staffName, StaffPassword: this.staffPassword }), () => this.refreshMember(), `${this.pointAmount} points added.`);
  }

  assignStamps() {
    if (!this.member || !this.staffName || this.stampAmount <= 0) return void this.notify('Select a member, enter the staff name, and choose a stamp amount.', 'warning');
    this.run(this.api.action('assign-stamp', { PhoneNumber: this.phone, StampCount: this.stampAmount, Amount: this.purchaseAmount, StaffName: this.staffName }), () => this.refreshMember(), `${this.stampAmount} stamp${this.stampAmount === 1 ? '' : 's'} added.`);
  }

  checkStamps() {
    if (!this.member) return void this.notify('Select a member first.', 'warning');
    this.run(this.api.action('check-stamp', { PhoneNumber: this.phone }), result => this.stampRecords = this.list(result), 'Stamp cards refreshed.');
  }

  useStamps() {
    if (!this.requireMemberAndStaff() || this.stampAmount <= 0) return;
    this.run(this.api.action('use-stamp', { PhoneNumber: this.phone, StampCount: this.stampAmount, StaffName: this.staffName, StaffPassword: this.staffPassword }), () => { this.refreshMember(); this.checkStamps(); }, 'Stamp reward used.');
  }

  redeemReward() {
    if (!this.requireMemberAndStaff() || !this.rewardId.trim()) return;
    this.run(this.api.action('redeem-reward', { Reward_Id: this.rewardId.trim(), PhoneNumber: this.phone, ReferenceNumber: this.referenceNumber || this.reference('REWARD'), StaffName: this.staffName, StaffPassword: this.staffPassword, verificationToken: this.rewardVerificationToken }), () => {
      this.rewardVerificationToken = '';
      this.refreshMember();
    }, 'Reward redeemed successfully.');
  }

  loadHistory() {
    this.transactionDetail = null;
    const source = this.memberOnlyHistory && this.member ? this.api.memberHistory(this.historyType, this.phone) : this.api.history(this.historyType);
    this.run(source, result => this.historyRecords = this.list(result).map(record => {
      if (this.historyType === 'points') return {
        ...record,
        PhoneNumber: record.MemberPhone ?? record.PhoneNumber,
        DateTime: record.DateAssign ?? record.DateTime,
        Status: record.Status ?? 'Points awarded',
      };
      if (this.historyType !== 'stamps') return record;
      const used = record.TotalUseStamp;
      const assigned = record.TotalAssignStamp;
      const count = used ?? assigned ?? record.StampCount ?? record.Stamp;
      return {
        ...record,
        DateTime: record.ClaimDate ?? record.AssignDate ?? record.DateTime ?? record.CreateDate,
        Status: record.Status ?? (used !== undefined ? 'Redeemed' : assigned !== undefined ? 'Earned' : 'Stamp activity'),
        Amount: count !== undefined ? `${count} stamp${Number(count) === 1 ? '' : 's'} ${used !== undefined ? 'redeemed' : assigned !== undefined ? 'earned' : ''}`.trim() : undefined,
      };
    }));
  }

  loadTopupDetails(record: any) {
    const topupId = String(this.display(record, 'TopupId', 'TopUpId', 'Id'));
    if (!topupId || topupId === '—') return void this.notify('This record does not contain a top-up ID.', 'warning');
    this.run(this.api.topupDetails(topupId), result => this.transactionDetail = this.first(result));
  }

  loadStaff(showErrors = true) {
    if (showErrors) {
      this.run(this.api.getStaff(), result => this.applyStaffRecords(result));
      return;
    }
    this.api.getStaff().subscribe({ next: result => this.applyStaffRecords(result) });
  }

  createStaff() {
    const value = this.staffForm;
    if (!value.staffName.trim() || !value.staffType.trim() || !/^\+?\d{8,15}$/.test(value.phoneNumber.trim()) || value.password.length < 4) {
      return void this.notify('Enter a staff name, role, valid phone number, and PIN of at least four characters.', 'warning');
    }
    this.run(this.api.createStaff(value), () => {
      this.staffForm = { staffName: '', staffType: 'Staff', phoneNumber: '', password: '' };
      this.loadStaff();
    }, 'Staff member created.');
  }

  async deleteStaff(record: any) {
    const staffId = String(this.display(record, 'StaffId', 'Id'));
    if (!staffId || staffId === '—' || this.busy || !await this.confirmAction('Remove staff member?', `Remove ${this.display(record, 'StaffName')} from this merchant?`, 'Remove')) return;
    this.run(this.api.deleteStaff(staffId), () => this.loadStaff(), 'Staff member removed.');
  }

  async voidRecord(record: any) {
    if (this.busy) return;
    const isTopup = this.historyType === 'topups';
    const decision = await this.confirmAction('Void transaction?', 'This transaction will be marked void. A wallet refund is not guaranteed. Review any points or stamps awarded separately.', 'Void transaction', isTopup);
    if (!decision || this.busy) return;
    if (this.historyType === 'spends') {
      const id = String(this.display(record, 'SpendId', 'Id'));
      this.run(this.api.action('void-spend', { SpendId: id }), result => {
        this.loadHistory();
        this.refreshMember();
        const message = result.walletRefundConfirmed === false
          ? 'Purchase voided. The wallet balance has not been restored. Check any stamps awarded separately.'
          : result.warning || 'Purchase voided. Review the member balance and any stamps awarded separately.';
        void this.notify(message, 'warning', 8000);
      });
    } else if (this.historyType === 'topups') {
      const id = String(this.display(record, 'TopupId', 'TopUpId', 'Id'));
      const reason = typeof decision === 'string' ? decision : 'Counter correction';
      this.run(this.api.action('void-topup', { TopupId: id, VoidDescription: reason }), () => this.loadHistory(), 'Top-up voided.');
    }
  }

  sendNotification() {
    if (!this.notificationTitle.trim() || !this.notificationBody.trim()) return void this.notify('Enter a title and message.', 'warning');
    if (this.notificationAudience === 'member' && !this.member) return void this.notify('Select the member who should receive this message.', 'warning');
    const body = { PhoneNumber: this.phone, DeviceId: this.member?.DeviceId || '', Type: 'Merchant', TargetId: this.merchantId, NotificationHeader: this.notificationTitle, NotificationBody: this.notificationBody };
    this.run(this.api.notification(this.notificationAudience, body), () => { this.notificationTitle = ''; this.notificationBody = ''; }, this.notificationAudience === 'all' ? 'Message sent to all members.' : 'Message sent to the member.');
  }

  loadEod() { this.run(this.api.eod(new Date(`${this.eodDate}T00:00:00`).toISOString()), result => this.eodResult = result, 'End-of-day report ready.'); }
  printPage() { window.print(); }
  selectTab(tab: PosTab) {
    this.stopCamera(); this.tab = tab; this.moreMenuOpen = false;
    if (tab === 'history') this.loadHistory();
    if (tab === 'staff') this.loadStaff();
    if ((tab === 'sale' || tab === 'topup' || tab === 'loyalty') && !this.staffRecords.length) this.loadStaff(false);
    if (tab === 'sale' && !this.catalog.length) this.loadCatalog(false);
    this.changeDetector.markForCheck();
  }
  get moreTabActive() { return !['sale', 'topup', 'loyalty'].includes(this.tab); }
  historyDate(record: any): Date | null {
    for (const key of ['SpendTime', 'DateTime', 'RedeemDate', 'DateAssign', 'ClaimDate', 'CreateDate', 'TransactionDate', 'TopupDate', 'AssignDate']) {
      const value = record?.[key];
      if (value === undefined || value === null || value === '') continue;
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) return date;
    }
    return null;
  }
  display(record: any, ...keys: string[]) { for (const key of keys) if (record?.[key] !== undefined && record[key] !== null && record[key] !== '') return record[key]; return '—'; }
  get phone() { return String(this.member?.PhoneNumber || this.member?.phoneNumber || this.member?.Phone || this.member?.phone || ''); }
  get memberName() { return this.member?.FullName || this.member?.Name || this.member?.fullName || this.member?.name || 'Eduvo member'; }
  get walletBalance() { return Number(this.member?.Balance ?? this.member?.WalletBalance ?? 0); }
  get points() { return Number(this.member?.Point ?? this.member?.Points ?? 0); }
  get stamps() { return Number(this.member?.TotalStamp ?? this.member?.Stamp ?? 0); }
  get categories() { return ['All', ...new Set(this.catalog.map(product => product.category))]; }
  get visibleProducts() { return this.selectedCategory === 'All' ? this.catalog : this.catalog.filter(product => product.category === this.selectedCategory); }
  get cartCount() { return this.cart.reduce((total, item) => total + item.quantity, 0); }
  get subtotal() { return this.cart.reduce((total, item) => total + item.price * item.quantity, 0); }
  get grandTotal() { return Math.max(0, this.subtotal - Number(this.discountAmount || 0)); }
  get estimatedPoints() { return Math.floor(this.grandTotal * Math.max(1, Number(this.member?.PointBonus || 1))); }

  private lookupMember(phone: string, verificationToken = '') {
    this.run(this.api.scanMember(phone, verificationToken), result => {
      this.member = this.first(result);
      if (!this.member.PhoneNumber) this.member.PhoneNumber = this.member.Phone || phone;
      this.scanValue = '';
      this.memberVerificationToken = '';
      if (this.tab === 'sale') this.saleStep = 'products';
    }, 'Member loaded. Enter the sale details, or choose Loyalty actions to add stamps or points.');
  }
  private applyStaffRecords(result: any) {
    this.zone.run(() => {
      this.staffRecords = this.list(result).filter(staff => staff.StaffName && (!staff.MerchantId || staff.MerchantId === this.merchantId));
      if (!this.staffRecords.some(staff => staff.StaffName === this.staffName)) {
        this.staffName = ''; this.staffPassword = '';
      }
      if (this.staffRecords.length === 1 && !this.staffName) this.staffName = String(this.staffRecords[0].StaffName || '');
      this.changeDetector.detectChanges();
    });
  }
  private refreshMember() {
    const phone = this.phone;
    if (phone) this.api.scanMember(phone).subscribe({
      next: result => this.zone.run(() => {
        this.member = this.first(result);
        this.changeDetector.detectChanges();
      })
    });
  }
  private requireMemberAndStaff() { if (!this.member || !this.staffName.trim() || !this.staffPassword) { void this.notify('Select a member and enter the staff name and PIN.', 'warning'); return false; } return true; }
  private parseQr(value: string) {
    const raw = value.trim();
    try {
      const parsed = JSON.parse(raw);
      const compactType = String(parsed.t || '');
      return {
        type: String(parsed.type || (compactType === 'M' ? 'LOYALTY_MEMBER' : compactType === 'R' ? 'LOYALTY_REWARD' : '')),
        phone: String(parsed.phoneNumber || parsed.PhoneNumber || parsed.phone || parsed.p || parsed.member?.phoneNumber || ''),
        rewardId: String(parsed.rewardId || parsed.RewardId || parsed.Reward_Id || parsed.voucherId || parsed.r || ''),
        verificationToken: String(parsed.verificationToken || parsed.v || '')
      };
    } catch {
      return {
        type: /^[A-Za-z0-9_-]{20,64}$/.test(raw) ? 'LOYALTY_MEMBER' : '',
        phone: /^\+?\d{8,15}$/.test(raw) ? raw : '',
        rewardId: '',
        verificationToken: /^[A-Za-z0-9_-]{20,64}$/.test(raw) ? raw : ''
      };
    }
  }
  entries(value: any) { return Object.entries(this.first(value)).filter(([, item]) => item !== null && item !== undefined && item !== ''); }
  private reference(prefix: string) { return `${prefix}-${Date.now()}`; }
  private first(value: any) { return this.list(value)[0] || {}; }
  private list(value: any): any[] { if (Array.isArray(value)) return value; if (!value || typeof value !== 'object') return []; for (const key of ['data','Data','items','Items','result','Result']) if (Array.isArray(value[key])) return value[key]; return [value]; }
  private run(source: any, success: (value: any) => void, message = '') {
    this.busy = true;
    source.subscribe({
      next: (value: any) => this.zone.run(() => {
        this.busy = false;
        success(value);
        this.changeDetector.detectChanges();
        if (message) void this.notify(message, 'success');
      }),
      error: (error: any) => this.zone.run(() => {
        this.busy = false;
        const errorMessage = error?.error?.message || '';
        if (error?.status === 401 && /application session/i.test(errorMessage)) {
          this.expireSession();
          return;
        }
        this.changeDetector.detectChanges();
        void this.notify(errorMessage || 'That action could not be completed. Check the details and try again.', 'danger');
      })
    });
  }
  private expireSession() { this.stopCamera(); localStorage.removeItem('pos_token'); localStorage.removeItem('pos_merchant_name'); this.loggedIn = false; this.member = null; void this.notify('Your counter session expired. Sign in again to continue.', 'warning'); }
  private async confirmAction(header: string, message: string, confirmText: string, requestReason = false): Promise<boolean | string> {
    if (this.confirmationOpen) return false;
    this.confirmationOpen = true;
    try {
      const alert = await this.alerts.create({
        header, message, backdropDismiss: false,
        inputs: requestReason ? [{ name: 'reason', type: 'text', placeholder: 'Reason for voiding', value: 'Counter correction' }] : [],
        buttons: [{ text: 'Cancel', role: 'cancel' }, { text: confirmText, role: 'confirm' }]
      });
      await alert.present();
      const result = await alert.onDidDismiss();
      if (result.role !== 'confirm') return false;
      return requestReason ? String(result.data?.values?.reason || '').trim() || 'Counter correction' : true;
    } finally { this.confirmationOpen = false; }
  }
  private async notify(message: string, color: string = 'dark', duration = 3200) {
    const toast = await this.toasts.create({
      message, duration, position: 'top', color,
      ...(duration >= 8000 ? { buttons: [{ text: 'Dismiss', role: 'cancel' }] } : {})
    });
    await toast.present();
  }
}
