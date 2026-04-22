import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { db, storage, ref, onValue, set, remove, update, storageRef, uploadBytes, getDownloadURL } from "./firebase";

// ─── Constants ───
// ROLE SYSTEM: 3 cấp bậc
// owner: toàn quyền (xóa, quản lý user, import/export)
// editor: thêm, sửa, xem
// viewer: chỉ xem
const ROLES = {
  owner: { l: "Chủ sở hữu", c: "#F59E0B", bg: "#FEF3C7", level: 3 },
  editor: { l: "Biên tập", c: "#3B82F6", bg: "#DBEAFE", level: 2 },
  viewer: { l: "Người xem", c: "#6B7280", bg: "#F3F4F6", level: 1 },
};

// Users DB (lưu trên Firebase, quản lý bởi owner)
const USERS_REF = "users";
const DEFAULT_USERS = {
  admin: { username: "admin", password: "admin123", role: "owner", displayName: "Admin" },
};

const canDelete = (role) => role === "owner";
const canEdit = (role) => role === "owner" || role === "editor";
const canImport = (role) => role === "owner" || role === "editor";

const ST = [
  { k: "DANG_VE", l: "Đang vẽ", c: "#6366F1", bg: "#EEF2FF" },
  { k: "CHO_REVIEW", l: "Chờ review", c: "#D97706", bg: "#FEF3C7" },
  { k: "DA_NOP", l: "Đã nộp", c: "#2563EB", bg: "#DBEAFE" },
  { k: "CHO_DUYET", l: "Chờ duyệt", c: "#7C3AED", bg: "#EDE9FE" },
  { k: "DA_DUYET", l: "Đã duyệt", c: "#059669", bg: "#D1FAE5" },
  { k: "REJECT", l: "Reject", c: "#DC2626", bg: "#FEE2E2" },
  { k: "DUYET_GC", l: "Duyệt có GC", c: "#0891B2", bg: "#CFFAFE" },
  { k: "TAI_NOP", l: "Tái nộp", c: "#EA580C", bg: "#FFEDD5" },
];
const ST_RFI = [
  { k: "OPEN", l: "Đang mở", c: "#D97706", bg: "#FEF3C7" },
  { k: "CLOSED", l: "Đã đóng", c: "#059669", bg: "#D1FAE5" },
];
const getStatusList = (type) => type === "RFI" ? ST_RFI : ST;
const getStatusItem = (type, k) => getStatusList(type).find(s => s.k === k);
const normRfiStatus = (s) => {
  if (s === "OPEN" || s === "CLOSED") return s;
  if (["DA_DUYET", "DUYET_GC"].includes(s)) return "CLOSED";
  return "OPEN";
};

// Root Cause categories cho RFI
const ROOT_CAUSES = [
  { k: "CONFLICT", l: "Mâu thuẫn bộ môn", c: "#DC2626", bg: "#FEE2E2", desc: "AR vs ST vs MEP" },
  { k: "MISSING_INFO", l: "Thiếu thông tin TK", c: "#EA580C", bg: "#FFEDD5", desc: "Bản vẽ thiếu chi tiết" },
  { k: "DESIGN_ERROR", l: "Sai sót thiết kế", c: "#D97706", bg: "#FEF3C7", desc: "Lỗi trong bản vẽ" },
  { k: "OWNER_CHANGE", l: "CĐT thay đổi", c: "#7C3AED", bg: "#EDE9FE", desc: "Thay đổi yêu cầu" },
  { k: "MATERIAL", l: "Vật liệu/Kỹ thuật", c: "#2563EB", bg: "#DBEAFE", desc: "Đổi vật liệu, phương án" },
  { k: "COORDINATION", l: "Phối hợp thi công", c: "#0891B2", bg: "#CFFAFE", desc: "Vấn đề phối hợp" },
  { k: "OTHER", l: "Khác", c: "#6B7280", bg: "#F3F4F6", desc: "" },
];

// Action status for action board
const ACTION_STATUS = [
  { k: "WAIT_TVTK", l: "Chờ TVTK phản hồi", c: "#D97706", bg: "#FEF3C7" },
  { k: "WAIT_CDT", l: "Chờ CĐT phản hồi", c: "#7C3AED", bg: "#EDE9FE" },
  { k: "IN_PROGRESS", l: "Đang xử lý", c: "#3B82F6", bg: "#DBEAFE" },
  { k: "DONE", l: "Đã đóng", c: "#059669", bg: "#D1FAE5" },
];

const RC = {
  late: { l: "Trễ hạn", c: "#DC2626", bg: "#FEE2E2", i: "🔴" },
  high: { l: "Nguy cơ cao", c: "#EA580C", bg: "#FFEDD5", i: "🟠" },
  med: { l: "Cần chú ý", c: "#D97706", bg: "#FEF3C7", i: "🟡" },
  ok: { l: "Đúng tiến độ", c: "#059669", bg: "#D1FAE5", i: "🟢" },
  done: { l: "Hoàn thành", c: "#6B7280", bg: "#F3F4F6", i: "✅" },
  reject: { l: "Reject", c: "#DC2626", bg: "#FEE2E2", i: "❌" },
  none: { l: "Chưa KH", c: "#9CA3AF", bg: "#F9FAFB", i: "⚪" },
};

const DEPTS = [
  { k: "CIV", l: "CIV", c: "#F59E0B", bg: "#FEF3C7" },
  { k: "MEP", l: "MEP", c: "#06B6D4", bg: "#CFFAFE" },
];
const DEPT_CATS = {
  CIV: ["Kết cấu", "Kiến trúc", "Hoàn thiện", "Nội thất", "Cảnh quan", "Hạ tầng"],
  MEP: ["Điện", "Nước", "PCCC", "HVAC", "Thang máy", "Hệ thống BMS"],
};

const STATUS_MAP = {
  "đang vẽ": "DANG_VE", "dang ve": "DANG_VE",
  "chờ review": "CHO_REVIEW", "cho review": "CHO_REVIEW",
  "đã nộp": "DA_NOP", "da nop": "DA_NOP",
  "chờ duyệt": "CHO_DUYET", "cho duyet": "CHO_DUYET",
  "đã duyệt": "DA_DUYET", "da duyet": "DA_DUYET",
  "reject": "REJECT",
  "duyệt có gc": "DUYET_GC", "duyet co gc": "DUYET_GC", "duyet gc": "DUYET_GC",
  "tái nộp": "TAI_NOP", "tai nop": "TAI_NOP",
  "đang mở": "OPEN", "dang mo": "OPEN", "open": "OPEN", "mở": "OPEN", "mo": "OPEN",
  "đã đóng": "CLOSED", "da dong": "CLOSED", "closed": "CLOSED", "đóng": "CLOSED", "dong": "CLOSED",
};

const DEPT_MAP = {
  "civ": "CIV", "civil": "CIV", "xâydựng": "CIV", "xaydung": "CIV",
  "mep": "MEP", "cơđiện": "MEP", "codien": "MEP",
};

// ─── Helpers ───
const td = () => new Date().toISOString().split("T")[0];
const ad = (d, n) => { if (!d) return ""; const x = new Date(d); x.setDate(x.getDate() + n); return x.toISOString().split("T")[0]; };
const dd = (a, b) => { if (!a || !b) return null; return Math.round((new Date(a) - new Date(b)) / 864e5); };
const fm = d => { if (!d) return "—"; const p = d.split("-"); return `${p[2]}/${p[1]}`; };
const fmFull = d => { if (!d) return "—"; const p = d.split("-"); return `${p[2]}/${p[1]}/${p[0]}`; };

const isDone = (it) => {
  if (it.type === "RFI") return normRfiStatus(it.status) === "CLOSED";
  return ["DA_DUYET", "DUYET_GC"].includes(it.status) || !!it.approveDate;
};
const apprPlan = (it) => it.actualDate ? ad(it.actualDate, it.offset || 0) : "";

function rsk(it) {
  if (it.type === "RFI") {
    if (normRfiStatus(it.status) === "CLOSED") {
      const ap = apprPlan(it);
      if (it.approveDate && ap && dd(it.approveDate, ap) > 0) return "late";
      return "done";
    }
    if (!it.actualDate) return "none";
    const ap = apprPlan(it);
    if (!ap) return "ok";
    const d = dd(ap, td());
    if (d < 0) return "late"; if (d <= 3) return "high"; if (d <= 7) return "med"; return "ok";
  }
  if (it.status === "REJECT") return "reject";
  if (isDone(it)) {
    const ap = apprPlan(it);
    if (it.approveDate && ap && dd(it.approveDate, ap) > 0) return "late";
    return "done";
  }
  if (!it.planDate && !it.actualDate) return "none";
  const ap = apprPlan(it);
  if (ap) {
    const d = dd(ap, td());
    if (d < 0) return "late"; if (d <= 3) return "high"; if (d <= 7) return "med"; return "ok";
  }
  if (!it.planDate) return "none";
  const d = dd(it.planDate, td());
  if (d < 0) return "late"; if (d <= 3) return "high"; if (d <= 7) return "med"; return "ok";
}

function subDelay(it) {
  if (it.type === "RFI") return null;
  if (!it.actualDate || !it.planDate) return null;
  const d = dd(it.actualDate, it.planDate);
  return d > 0 ? d : 0;
}

function ld(it) {
  const ap = apprPlan(it);
  if (!ap) return null;
  if (isDone(it)) {
    if (!it.approveDate) return null;
    const d = dd(it.approveDate, ap);
    return d > 0 ? d : 0;
  }
  const d = dd(td(), ap);
  return d > 0 ? d : 0;
}

// Week helpers for trend chart
function getWeekKey(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  return monday.toISOString().split("T")[0];
}

function getWeekLabel(weekKey) {
  if (!weekKey) return "";
  const d = new Date(weekKey);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

// File type icon
function fileIcon(name) {
  if (!name) return "📎";
  const ext = name.split(".").pop().toLowerCase();
  if (["jpg", "jpeg", "png", "gif", "webp", "bmp"].includes(ext)) return "🖼️";
  if (["pdf"].includes(ext)) return "📄";
  if (["doc", "docx"].includes(ext)) return "📝";
  if (["xls", "xlsx", "csv"].includes(ext)) return "📊";
  if (["ppt", "pptx"].includes(ext)) return "📽️";
  if (["dwg", "dxf"].includes(ext)) return "📐";
  if (["msg", "eml"].includes(ext)) return "📧";
  if (["zip", "rar", "7z"].includes(ext)) return "📦";
  return "📎";
}

// ─── Sample Data ───
function samples() {
  const d = n => ad(td(), n);
  return [
    { id: "s1", type: "SD", code: "SD-KC-001", name: "MB cốp pha sàn T5 — Block A", block: "Block A", floor: "T5", dept: "CIV", cat: "Kết cấu", who: "Nguyễn Văn Hùng", sub: "Trương Thanh Tân", status: "DA_DUYET", planDate: d(-20), actualDate: d(-19), approveDate: d(-12), offset: 7, rev: 0, links: ["r1"], notes: [{ id: "n1", t: "Phối hợp MEP ok — không xung đột", d: d(-21), h: "09:30" }, { id: "n2", t: "TVTK confirm cao độ +14.200", d: d(-19), h: "14:15" }] },
    { id: "s2", type: "SD", code: "SD-KC-002", name: "Chi tiết thép sàn T5 — Block A", block: "Block A", floor: "T5", dept: "CIV", cat: "Kết cấu", who: "Nguyễn Văn Hùng", sub: "Trương Thanh Tân", status: "DUYET_GC", planDate: d(-15), actualDate: d(-14), approveDate: d(-5), offset: 7, rev: 1, rootCause: "CONFLICT", links: [], notes: [{ id: "n3", t: "Comment: bổ sung thép gia cường lỗ mở >300mm", d: d(-8), h: "10:00" }] },
    { id: "s3", type: "SD", code: "SD-KC-003", name: "MB cốp pha sàn T6 — Block A", block: "Block A", floor: "T6", dept: "CIV", cat: "Kết cấu", who: "Nguyễn Văn Hùng", sub: "Trương Thanh Tân", status: "CHO_DUYET", planDate: d(-5), actualDate: d(-4), offset: 7, rev: 0, links: [], notes: [] },
    { id: "s4", type: "SD", code: "SD-KC-004", name: "Chi tiết thép sàn T6 — Block A", block: "Block A", floor: "T6", dept: "CIV", cat: "Kết cấu", who: "Trần Minh Đức", sub: "Trương Thanh Tân", status: "DANG_VE", planDate: d(2), actualDate: "", offset: 7, rev: 0, links: ["r3"], notes: [{ id: "n5", t: "Chờ RFI-003 confirm lỗ thang máy", d: d(-1), h: "08:45" }] },
    { id: "s5", type: "SD", code: "SD-KC-005", name: "Chi tiết dầm T7 — Block A", block: "Block A", floor: "T7", dept: "CIV", cat: "Kết cấu", who: "Trần Minh Đức", sub: "Trương Thanh Tân", status: "DANG_VE", planDate: d(10), actualDate: "", offset: 7, rev: 0, links: [], notes: [] },
    { id: "s6", type: "SD", code: "SD-KT-001", name: "MB tường xây T3 — Block A", block: "Block A", floor: "T3", dept: "CIV", cat: "Kiến trúc", who: "Lê Thị Mai", sub: "Trương Thanh Tân", status: "REJECT", planDate: d(-12), actualDate: d(-11), offset: 5, rev: 0, links: ["r2"], notes: [{ id: "n6", t: "Reject: sai kích thước cửa sổ 1000x1400 thay vì 1200x1400", d: d(-5), h: "11:20" }] },
    { id: "s7", type: "SD", code: "SD-KT-002", name: "MB tường xây T3 — Block A (Rev1)", block: "Block A", floor: "T3", dept: "CIV", cat: "Kiến trúc", who: "Lê Thị Mai", sub: "Trương Thanh Tân", status: "TAI_NOP", planDate: d(-3), actualDate: d(-2), offset: 5, rev: 1, links: ["s6", "r2"], notes: [{ id: "n7", t: "Đã sửa kích thước cửa theo KT rev3", d: d(-2), h: "09:00" }] },
    { id: "s8", type: "SD", code: "SD-KT-003", name: "Chi tiết ốp lát WC T4 — Block A", block: "Block A", floor: "T4", dept: "CIV", cat: "Hoàn thiện", who: "Lê Thị Mai", sub: "Trương Thanh Tân", status: "CHO_REVIEW", planDate: d(1), actualDate: "", offset: 5, rev: 0, links: [], notes: [{ id: "n8", t: "Chờ confirm mẫu gạch từ CĐT", d: d(0), h: "15:00" }] },
    { id: "s9", type: "SD", code: "SD-KC-006", name: "MB cốp pha sàn T3 — Block B", block: "Block B", floor: "T3", dept: "CIV", cat: "Kết cấu", who: "Phạm Quốc Bảo", sub: "Trương Thanh Tân", status: "DA_DUYET", planDate: d(-25), actualDate: d(-26), approveDate: d(-20), offset: 7, rev: 0, links: [], notes: [] },
    { id: "s10", type: "SD", code: "SD-KC-007", name: "Chi tiết thép vách T3 — Block B", block: "Block B", floor: "T3", dept: "CIV", cat: "Kết cấu", who: "Phạm Quốc Bảo", sub: "Trương Thanh Tân", status: "DA_NOP", planDate: d(-8), actualDate: d(-6), offset: 7, rev: 0, links: [], notes: [{ id: "n9", t: "Nộp trễ 2 ngày — chờ phối hợp MEP", d: d(-6), h: "17:30" }] },
    { id: "s11", type: "SD", code: "SD-KC-008", name: "MB cốp pha sàn T4 — Block B", block: "Block B", floor: "T4", dept: "CIV", cat: "Kết cấu", who: "Phạm Quốc Bảo", sub: "Trương Thanh Tân", status: "DANG_VE", planDate: d(-2), actualDate: "", offset: 7, rev: 0, links: [], notes: [{ id: "n10", t: "⚠️ Trễ 2 ngày — Bảo đang làm song song vách T3", d: d(0), h: "08:00" }] },
    { id: "s12", type: "SD", code: "SD-MEP-001", name: "MB PCCC T2 — Block B", block: "Block B", floor: "T2", dept: "MEP", cat: "PCCC", who: "Võ Hoàng Long", sub: "Trương Thanh Tân", status: "DA_DUYET", planDate: d(-18), actualDate: d(-20), approveDate: d(-14), offset: 5, rev: 0, links: [], notes: [] },
    { id: "s13", type: "SD", code: "SD-MEP-002", name: "MB điện T3 — Block B", block: "Block B", floor: "T3", dept: "MEP", cat: "Điện", who: "Võ Hoàng Long", sub: "Trương Thanh Tân", status: "CHO_DUYET", planDate: d(-7), actualDate: d(-6), offset: 5, rev: 0, links: ["r4"], notes: [{ id: "n11", t: "Đã phối hợp KC — tránh xuyên dầm chính", d: d(-7), h: "14:00" }] },
    { id: "s14", type: "SD", code: "SD-MEP-003", name: "MB cấp thoát nước T3 — Block B", block: "Block B", floor: "T3", dept: "MEP", cat: "Nước", who: "Võ Hoàng Long", sub: "Trương Thanh Tân", status: "DANG_VE", planDate: d(5), actualDate: "", offset: 5, rev: 0, links: [], notes: [] },
    { id: "s15", type: "SD", code: "SD-KC-009", name: "MB cốp pha hầm B1 — Block C", block: "Block C", floor: "B1", dept: "CIV", cat: "Kết cấu", who: "Trần Minh Đức", sub: "Trương Thanh Tân", status: "DA_NOP", planDate: d(-10), actualDate: d(-10), offset: 7, rev: 0, links: ["r5"], notes: [] },
    { id: "r1", type: "RFI", code: "RFI-001", name: "Cao độ sàn T5 Block A — sai khác KT vs KC", block: "Block A", floor: "T5", dept: "CIV", cat: "Kết cấu", who: "Trương Thanh Tân", sub: "Trương Thanh Tân", status: "CLOSED", planDate: "", actualDate: d(-22), approveDate: d(-20), offset: 3, rev: 0, rootCause: "CONFLICT", actionStatus: "DONE", actionOwner: "TVTK", links: ["s1"], notes: [{ id: "rn1", t: "KT +14.100 vs KC +14.200 → TVTK confirm theo KC", d: d(-20), h: "10:00" }] },
    { id: "r2", type: "RFI", code: "RFI-002", name: "Kích thước cửa sổ T3 Block A — rev2 vs rev3", block: "Block A", floor: "T3", dept: "CIV", cat: "Kiến trúc", who: "Trương Thanh Tân", sub: "Trương Thanh Tân", status: "CLOSED", planDate: "", actualDate: d(-13), approveDate: d(-10), offset: 3, rev: 0, rootCause: "MISSING_INFO", actionStatus: "DONE", actionOwner: "CĐT", links: ["s6", "s7"], notes: [{ id: "rn2", t: "CĐT confirm rev3: cửa 1200x1400mm", d: d(-10), h: "11:00" }] },
    { id: "r3", type: "RFI", code: "RFI-003", name: "Vị trí lỗ thang máy T6 Block A — chênh 150mm", block: "Block A", floor: "T6", dept: "CIV", cat: "Kết cấu", who: "Trương Thanh Tân", sub: "Trương Thanh Tân", status: "OPEN", planDate: "", actualDate: d(-3), offset: 3, rev: 0, rootCause: "CONFLICT", actionStatus: "WAIT_TVTK", actionOwner: "TVTK", actionDeadline: d(1), links: ["s4"], notes: [{ id: "rn3", t: "Gửi TVTK bản vẽ so sánh, chờ phản hồi", d: d(-3), h: "09:30" }] },
    { id: "r4", type: "RFI", code: "RFI-004", name: "Sleeve ống điện ∅60 T3 Block B", block: "Block B", floor: "T3", dept: "MEP", cat: "Điện", who: "Trương Thanh Tân", sub: "Trương Thanh Tân", status: "OPEN", planDate: "", actualDate: d(-1), offset: 3, rev: 0, rootCause: "COORDINATION", actionStatus: "IN_PROGRESS", actionOwner: "Nhà thầu", actionDeadline: d(3), links: ["s13"], notes: [{ id: "rn4", t: "Cần vẽ chi tiết sleeve trước khi gửi", d: d(0), h: "16:00" }] },
    { id: "r5", type: "RFI", code: "RFI-005", name: "Chống thấm hầm B1 Block C — đổi vật liệu", block: "Block C", floor: "B1", dept: "CIV", cat: "Kết cấu", who: "Trương Thanh Tân", sub: "Trương Thanh Tân", status: "OPEN", planDate: "", actualDate: d(-8), offset: 5, rev: 0, rootCause: "MATERIAL", actionStatus: "WAIT_CDT", actionOwner: "CĐT", actionDeadline: d(-2), links: ["s15"], notes: [{ id: "rn5", t: "CĐT reject: yêu cầu bảng so sánh giá 3 loại chống thấm", d: d(-4), h: "14:30" }, { id: "rn6", t: "Đang lấy báo giá Sika, Mapei, CT11A", d: d(-2), h: "09:00" }] },
    { id: "r6", type: "RFI", code: "RFI-006", name: "Thay đổi hộp kỹ thuật T4 Block A", block: "Block A", floor: "T4", dept: "MEP", cat: "HVAC", who: "Trương Thanh Tân", sub: "Trương Thanh Tân", status: "OPEN", planDate: "", actualDate: d(-5), offset: 3, rev: 0, rootCause: "OWNER_CHANGE", actionStatus: "WAIT_CDT", actionOwner: "CĐT", actionDeadline: d(-1), links: [], notes: [] },
  ];
}

// ─── Firebase helpers ───
const ITEMS_REF = "items";
function writeAllItems(arr) { const o = {}; arr.forEach(it => { o[it.id] = it; }); set(ref(db, ITEMS_REF), o); }
function writeItem(item) { set(ref(db, `${ITEMS_REF}/${item.id}`), item); }
function deleteItem(id) { remove(ref(db, `${ITEMS_REF}/${id}`)); }
function updateItem(id, data) { update(ref(db, `${ITEMS_REF}/${id}`), data); }

async function uploadFile(file, itemId) {
  const ts = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `attachments/${itemId}/${ts}_${safeName}`;
  const sRef = storageRef(storage, path);
  await uploadBytes(sRef, file);
  const url = await getDownloadURL(sRef);
  return { name: file.name, url, size: file.size, path };
}

// ─── CSV/Import helpers ───
function parseCSV(text) {
  const lines = text.split("\n").map(l => l.replace(/\r$/, "")).filter(l => l.trim());
  if (lines.length < 2) return [];
  const firstLine = lines[0];
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  const delimiter = tabCount > commaCount ? "\t" : ",";
  function parseLine(line) {
    const result = []; let current = ""; let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) { if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; } else if (ch === '"') { inQuotes = false; } else { current += ch; } }
      else { if (ch === '"') { inQuotes = true; } else if (ch === delimiter) { result.push(current.trim()); current = ""; } else { current += ch; } }
    }
    result.push(current.trim()); return result;
  }
  const headers = parseLine(lines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9_àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/gi, "").trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) { const vals = parseLine(lines[i]); if (vals.every(v => !v)) continue; const row = {}; headers.forEach((h, j) => { row[h] = vals[j] || ""; }); rows.push(row); }
  return rows;
}

function mapRowToItem(row, index) {
  const r = {}; Object.entries(row).forEach(([k, v]) => { r[k.toLowerCase().replace(/\s+/g, "")] = v; });
  const code = r.code || r.ma || r.masd || r.marfi || r.mã || r.mãsd || r.mãrfi || "";
  const rawType = (r.type || r.loai || r.loại || "").toUpperCase().trim();
  const type = rawType === "RFI" ? "RFI" : rawType === "SD" ? "SD" : code.toUpperCase().startsWith("RFI") ? "RFI" : "SD";
  const rawStatus = (r.status || r.trangthai || r.trạngthái || r.tt || "").toLowerCase().trim();
  const defaultStatus = type === "RFI" ? "OPEN" : "DANG_VE";
  let status = STATUS_MAP[rawStatus] || getStatusList(type).find(s => s.k === rawStatus.toUpperCase())?.k || defaultStatus;
  const validKeys = getStatusList(type).map(s => s.k);
  if (!validKeys.includes(status)) {
    status = type === "RFI" ? normRfiStatus(status) : defaultStatus;
  }
  const rawDept = (r.dept || r.bophan || r.bộphận || r.bp || "").toLowerCase().trim();
  const dept = DEPT_MAP[rawDept] || (rawDept === "mep" ? "MEP" : rawDept === "civ" ? "CIV" : "CIV");
  function parseDate(val) {
    if (!val) return ""; val = val.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
    const m = val.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    return "";
  }
  // Root cause mapping
  const rawRC = (r.rootcause || r.nguyennhan || r.nguyênnhân || r.nguyen_nhan || "").toUpperCase().trim();
  const rootCause = ROOT_CAUSES.find(rc => rc.k === rawRC)?.k || "";

  return {
    id: Date.now().toString(36) + "_" + index + "_" + Math.random().toString(36).slice(2, 6),
    type, code: code || `${type}-${String(index + 1).padStart(3, "0")}`,
    name: r.name || r.ten || r.tên || r.tenbảnvẽ || r.tenbảnve || r.tenbanve || "",
    block: r.block || r.phânkhu || r.phankhu || "",
    floor: r.floor || r.tang || r.tầng || "",
    dept,
    cat: r.cat || r.hangmuc || r.hạngmục || r.hangmục || r.hạngmuc || r.hm || "",
    who: r.who || r.nguoive || r.người_vẽ || r.nguoivẽ || r.ngườivẽ || "",
    sub: r.sub || r.detrinh || r.đệtrình || r.nguoidetrinh || "",
    status,
    planDate: parseDate(r.plandate || r.khnộp || r.khnop || r.ngàykh || r.ngaykh || ""),
    actualDate: parseDate(r.actualdate || r.ttnop || r.ttnộp || r.thựctế || r.ngàynộp || r.ngaynop || ""),
    approveDate: parseDate(r.approvedate || r.ttduyet || r.ttduyệt || r.ttđóng || r.ttdong || r.ngàyduyệt || r.ngayduyet || r.ngàyđóng || r.ngaydong || ""),
    offset: parseInt(r.offset || (type === "RFI" ? "3" : "7")) || (type === "RFI" ? 3 : 7),
    rev: parseInt(r.rev || "0") || 0, links: [], notes: [],
    rootCause: type === "RFI" ? rootCause : "",
    actionStatus: "", actionOwner: "", actionDeadline: "",
  };
}

// ─── Export helpers ───
function itemsToCSV(items, filterType) {
  const headers = ["Loại", "Mã", "Tên", "Block", "Tầng", "Bộ phận", "Hạng mục", "Người vẽ", "Đệ trình", "Trạng thái", "Rủi ro", "KH nộp", "TT nộp", "Trễ trình", "Offset", "KH duyệt/đóng", "TT duyệt/đóng", "Delay", "Nguyên nhân", "Rev", "Ghi chú"];
  const src = filterType ? items.filter(i => i.type === filterType) : items;
  const rows = src.map(it => {
    const st = getStatusItem(it.type, it.status); const r = rsk(it); const rc = RC[r]; const l = ld(it); const sd = subDelay(it);
    const rootCauseLabel = ROOT_CAUSES.find(rc => rc.k === it.rootCause)?.l || "";
    const notesText = (it.notes || []).map(n => `[${n.d} ${n.h}] ${n.t}${n.file ? ` [File: ${n.file.name}]` : ""}`).join(" | ");
    return [it.type, it.code, it.name, it.block, it.floor, it.dept || "", it.cat, it.who, it.sub, st?.l || it.status, rc?.l || r, it.planDate || "", it.actualDate || "", sd != null ? sd : "", it.offset, apprPlan(it) || "", it.approveDate || "", l != null ? l : "", rootCauseLabel, it.rev, notesText];
  });
  const escape = v => { const s = String(v ?? ""); if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`; return s; };
  return [headers.map(escape).join(","), ...rows.map(r => r.map(escape).join(","))].join("\n");
}

function generateReportHTML(items, stats) {
  const today = td();
  const done = items.filter(i => isDone(i)).length;
  const pct = stats.tot ? Math.round(done / stats.tot * 100) : 0;
  const sdItems = items.filter(i => i.type === "SD"); const rfiItems = items.filter(i => i.type === "RFI");
  const lateItems = items.filter(i => rsk(i) === "late"); const highItems = items.filter(i => rsk(i) === "high");
  function makeTable(list) {
    if (!list.length) return "<p style='color:#64748B;padding:12px'>Không có dữ liệu</p>";
    return `<table><thead><tr><th>Mã</th><th>Tên</th><th>Block</th><th>Tầng</th><th>BP</th><th>HM</th><th>Người vẽ</th><th>Trạng thái</th><th>KH nộp</th><th>TT nộp</th><th>Trễ trình</th><th>KH duyệt</th><th>TT duyệt</th><th>Delay</th><th>Nguyên nhân</th></tr></thead>
    <tbody>${list.map(it => {
      const st = getStatusItem(it.type, it.status); const l = ld(it); const sd = subDelay(it);
      const dpt = DEPTS.find(d => d.k === it.dept);
      const rcLabel = ROOT_CAUSES.find(rc => rc.k === it.rootCause)?.l || "—";
      return `<tr><td style="font-weight:700;font-family:monospace">${it.code}</td><td>${it.name||"—"}</td><td>${it.block}</td><td>${it.floor}</td>
      <td><span style="padding:2px 6px;border-radius:10px;font-size:10px;font-weight:700;background:${dpt?.bg||"#F3F4F6"};color:${dpt?.c||"#6B7280"}">${it.dept||"—"}</span></td>
      <td>${it.cat}</td><td>${it.who}</td>
      <td><span style="padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;background:${st?.bg};color:${st?.c}">${st?.l}</span></td>
      <td style="font-family:monospace;font-size:12px">${fm(it.planDate)}</td><td style="font-family:monospace;font-size:12px">${fm(it.actualDate)}</td>
      <td>${sd>0?`<span style="color:#EA580C;font-weight:700">+${sd}</span>`:sd===0?"0":"—"}</td>
      <td style="font-family:monospace;font-size:12px">${fm(apprPlan(it))}</td>
      <td style="font-family:monospace;font-size:12px">${fm(it.approveDate)}</td>
      <td>${l>0?`<span style="color:#DC2626;font-weight:700">+${l}</span>`:l===0?"0":"—"}</td>
      <td>${rcLabel}</td></tr>`;
    }).join("")}</tbody></table>`;
  }
  return `<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Báo cáo SD & RFI — Wealthcons — ${today}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Segoe UI',Tahoma,sans-serif;background:#fff;color:#1E293B;padding:32px;max-width:1200px;margin:0 auto;font-size:13px}
h1{font-size:22px;margin-bottom:4px}h2{font-size:16px;margin:24px 0 10px;padding-bottom:6px;border-bottom:2px solid #E2E8F0}.meta{color:#64748B;font-size:12px;margin-bottom:24px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:20px}.card{padding:14px;border-radius:8px;border-left:4px solid;background:#F8FAFC}.card .val{font-size:28px;font-weight:800;font-family:monospace}.card .lbl{font-size:11px;color:#64748B;margin-top:2px}
table{width:100%;border-collapse:collapse;margin-bottom:16px;font-size:12px}th{background:#F1F5F9;text-align:left;padding:8px 6px;font-weight:600;color:#475569;border-bottom:2px solid #E2E8F0;font-size:11px}td{padding:7px 6px;border-bottom:1px solid #F1F5F9}tr:hover{background:#F8FAFC}
.alert{border-left:4px solid #DC2626;background:#FEF2F2;padding:10px 14px;border-radius:6px;margin-bottom:6px}.alert .code{font-weight:700;font-family:monospace}
@media print{body{padding:16px;font-size:11px}h1{font-size:18px}h2{font-size:14px}}.footer{margin-top:32px;padding-top:12px;border-top:1px solid #E2E8F0;color:#94A3B8;font-size:11px;text-align:center}</style></head><body>
<h1>📐 BÁO CÁO SD & RFI</h1><p class="meta">Wealthcons · Ngày xuất: ${today} · Tổng: ${stats.tot} items</p>
<div class="cards">
  <div class="card" style="border-color:#3B82F6"><div class="val" style="color:#3B82F6">${stats.sd}</div><div class="lbl">Shop Drawing</div></div>
  <div class="card" style="border-color:#8B5CF6"><div class="val" style="color:#8B5CF6">${stats.rfi}</div><div class="lbl">RFI</div></div>
  <div class="card" style="border-color:#F59E0B"><div class="val" style="color:#F59E0B">${items.filter(i=>i.dept==="CIV").length}</div><div class="lbl">CIV</div></div>
  <div class="card" style="border-color:#06B6D4"><div class="val" style="color:#06B6D4">${items.filter(i=>i.dept==="MEP").length}</div><div class="lbl">MEP</div></div>
  <div class="card" style="border-color:#DC2626"><div class="val" style="color:#DC2626">${stats.bR.late}</div><div class="lbl">Trễ hạn</div></div>
  <div class="card" style="border-color:#059669"><div class="val" style="color:#059669">${done}</div><div class="lbl">Đã duyệt</div></div>
  <div class="card" style="border-color:#0891B2"><div class="val" style="color:#0891B2">${pct}%</div><div class="lbl">Tỷ lệ HT</div></div>
</div>
${(lateItems.length+highItems.length)>0?`<h2>⚠️ Cảnh báo (${lateItems.length+highItems.length})</h2>${[...lateItems,...highItems].map(it=>{const l=ld(it);const r=rsk(it);return`<div class="alert"><span class="code">${it.code}</span> — ${it.name} · ${it.dept} · ${it.block} ${it.floor} · ${it.who} · ${r==="late"?`Trễ ${l} ngày`:"Nguy cơ cao"}</div>`;}).join("")}`:""}
<h2>📐 Shop Drawing (${sdItems.length})</h2>${makeTable(sdItems)}<h2>📝 RFI (${rfiItems.length})</h2>${makeTable(rfiItems)}
<div class="footer">Wealthcons SD & RFI Tracker · Xuất tự động · ${new Date().toLocaleString("vi-VN")}</div></body></html>`;
}

// ─── Charts ───
function Donut({ data, size = 130 }) {
  const tot = data.reduce((s, d) => s + d.v, 0);
  if (!tot) return <div style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center", color: "#64748B", fontSize: 12 }}>Trống</div>;
  let c = 0; const r = size / 2 - 5, cx = size / 2, cy = size / 2;
  return (<svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
    {data.filter(d => d.v > 0).map((d, i) => { const s = c / tot; c += d.v; const e = c / tot;
      if (e - s >= .999) return <circle key={i} cx={cx} cy={cy} r={r} fill={d.c} opacity={.85} />;
      const lg = e - s > .5 ? 1 : 0;
      const sx = cx + r * Math.cos(2 * Math.PI * s - Math.PI / 2), sy = cy + r * Math.sin(2 * Math.PI * s - Math.PI / 2);
      const ex = cx + r * Math.cos(2 * Math.PI * e - Math.PI / 2), ey = cy + r * Math.sin(2 * Math.PI * e - Math.PI / 2);
      return <path key={i} d={`M${cx},${cy}L${sx},${sy}A${r},${r} 0 ${lg} 1 ${ex},${ey}Z`} fill={d.c} opacity={.85} />;
    })}<circle cx={cx} cy={cy} r={r * .5} fill="#0F172A" /><text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="middle" fill="#F1F5F9" fontSize={18} fontWeight={800}>{tot}</text></svg>);
}
function Bar({ data, h = 160 }) {
  const mx = Math.max(...data.map(d => d.v), 1); const bw = Math.min(32, Math.max(14, 240 / data.length - 4)); const w = data.length * (bw + 5) + 16;
  return (<svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet">
    {data.map((d, i) => { const bh = (d.v / mx) * (h - 28); const x = 8 + i * (bw + 5); return (<g key={i}><rect x={x} y={h - 16 - bh} width={bw} height={bh} rx={3} fill={d.c} opacity={.8} /><text x={x + bw / 2} y={h - 20 - bh} textAnchor="middle" fill="#94A3B8" fontSize={9} fontWeight={700}>{d.v}</text><text x={x + bw / 2} y={h - 3} textAnchor="middle" fill="#64748B" fontSize={7}>{d.l.length > 7 ? d.l.slice(0, 6) + "…" : d.l}</text></g>); })}</svg>);
}
function Seg({ data, h = 22 }) { const tot = data.reduce((s, d) => s + d.v, 0); if (!tot) return <div style={{ height: h, borderRadius: 6, background: "#1E293B" }} />; return <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", height: h }}>{data.filter(d => d.v > 0).map((d, i) => <div key={i} style={{ width: `${d.v / tot * 100}%`, background: d.c, minWidth: 2 }} title={`${d.l}: ${d.v}`} />)}</div>; }
function Bd({ children, c, bg }) { return <span style={{ padding: "2px 9px", borderRadius: 16, fontSize: 11, fontWeight: 600, background: bg, color: c, whiteSpace: "nowrap" }}>{children}</span>; }

// ─── Mini Line Chart for Trends ───
function TrendChart({ data, h = 140, labels }) {
  if (!data || !data.length) return <div style={{ height: h, display: "flex", alignItems: "center", justifyContent: "center", color: "#64748B", fontSize: 12 }}>Chưa có dữ liệu</div>;
  const maxV = Math.max(...data.flatMap(s => s.values), 1);
  const w = Math.max(data[0].values.length * 50, 200);
  const pad = { t: 20, b: 28, l: 30, r: 10 };
  const cw = w - pad.l - pad.r;
  const ch = h - pad.t - pad.b;
  const n = data[0].values.length;

  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet">
      {/* Grid lines */}
      {[0, 0.25, 0.5, 0.75, 1].map((f, i) => (
        <g key={i}>
          <line x1={pad.l} y1={pad.t + ch * (1 - f)} x2={w - pad.r} y2={pad.t + ch * (1 - f)} stroke="#1E293B" strokeWidth={1} />
          <text x={pad.l - 4} y={pad.t + ch * (1 - f) + 3} textAnchor="end" fill="#64748B" fontSize={8}>{Math.round(maxV * f)}</text>
        </g>
      ))}
      {/* Lines */}
      {data.map((series, si) => {
        const points = series.values.map((v, i) => {
          const x = pad.l + (i / (n - 1 || 1)) * cw;
          const y = pad.t + ch - (v / maxV) * ch;
          return `${x},${y}`;
        });
        return (
          <g key={si}>
            <polyline points={points.join(" ")} fill="none" stroke={series.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            {series.values.map((v, i) => {
              const x = pad.l + (i / (n - 1 || 1)) * cw;
              const y = pad.t + ch - (v / maxV) * ch;
              return <circle key={i} cx={x} cy={y} r={3} fill={series.color} />;
            })}
          </g>
        );
      })}
      {/* X labels */}
      {labels && labels.map((l, i) => (
        <text key={i} x={pad.l + (i / (n - 1 || 1)) * cw} y={h - 4} textAnchor="middle" fill="#64748B" fontSize={8}>{l}</text>
      ))}
    </svg>
  );
}

// ─── KPI Card ───
function KPICard({ label, value, target, unit = "", icon }) {
  const numVal = parseFloat(value) || 0;
  const numTarget = parseFloat(target) || 0;
  const isGood = unit === "%" ? numVal >= numTarget : unit === "ngày" ? numVal <= numTarget : numVal <= numTarget;
  const pct = numTarget ? Math.min(numVal / numTarget * 100, 150) : 0;
  return (
    <div style={{ background: "#0F172A", borderRadius: 8, padding: "12px 14px", borderLeft: `3px solid ${isGood ? "#059669" : "#DC2626"}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 10, color: "#64748B", marginBottom: 2 }}>{icon} {label}</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: isGood ? "#059669" : "#DC2626", fontFamily: "'JetBrains Mono'" }}>
            {value}{unit}
          </div>
        </div>
        <div style={{ padding: "2px 8px", borderRadius: 12, fontSize: 10, fontWeight: 600, background: isGood ? "#D1FAE5" : "#FEE2E2", color: isGood ? "#059669" : "#DC2626" }}>
          Target: {target}{unit}
        </div>
      </div>
      <div style={{ height: 4, borderRadius: 2, background: "#1E293B", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${Math.min(pct, 100)}%`, background: isGood ? "#059669" : "#DC2626", borderRadius: 2 }} />
      </div>
    </div>
  );
}

// ─── Import Modal ───
function ImportModal({ onImport, onClose }) {
  const [text, setText] = useState(""); const [preview, setPreview] = useState([]); const [error, setError] = useState(""); const fileRef = useRef(null);
  const handleFile = (e) => { const file = e.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = (ev) => { setText(ev.target.result); processText(ev.target.result); }; reader.readAsText(file); };
  const processText = (t) => { setError(""); if (!t.trim()) { setPreview([]); return; } try { const rows = parseCSV(t); if (!rows.length) { setError("Không tìm thấy dữ liệu."); return; } setPreview(rows.map((r, i) => mapRowToItem(r, i))); } catch (e) { setError("Lỗi parse: " + e.message); } };
  const handleTextChange = (val) => { setText(val); if (val.trim()) processText(val); else setPreview([]); };
  const I = { padding: "8px 10px", borderRadius: 7, border: "1px solid #334155", background: "#0F172A", color: "#F1F5F9", fontSize: 12, width: "100%" };
  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.7)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div style={{ background: "#1E293B", borderRadius: 12, padding: 20, width: "100%", maxWidth: 800, maxHeight: "90vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}><h2 style={{ fontSize: 16, fontWeight: 800 }}>📥 Nhập dữ liệu từ Excel/CSV</h2><button onClick={onClose} style={{ background: "none", border: "none", color: "#64748B", fontSize: 18, cursor: "pointer" }}>✕</button></div>
        <div style={{ background: "#0F172A", borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 11, color: "#94A3B8", lineHeight: 1.6 }}>
          <div style={{ fontWeight: 700, color: "#F1F5F9", marginBottom: 4 }}>Hướng dẫn:</div>
          <div>1. Mở file Excel → Ctrl+A → Ctrl+C → Paste vào ô bên dưới</div>
          <div>2. Hoặc xuất file CSV/TSV từ Excel rồi chọn file</div>
          <div style={{ marginTop: 6, fontWeight: 600, color: "#F59E0B" }}>Các cột: Code/Mã, Tên, Block, Tầng, Bộ phận/Dept (CIV/MEP), Hạng mục, Người vẽ, Đệ trình, Trạng thái, KH nộp, TT nộp, TT duyệt, Offset, Nguyên nhân, Rev</div>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}><button onClick={() => fileRef.current?.click()} style={{ padding: "8px 14px", borderRadius: 7, border: "1px solid #334155", background: "transparent", color: "#3B82F6", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>📁 Chọn file CSV/TSV</button><input ref={fileRef} type="file" accept=".csv,.tsv,.txt" onChange={handleFile} style={{ display: "none" }} /></div>
        <textarea value={text} onChange={e => handleTextChange(e.target.value)} placeholder={"Paste dữ liệu từ Excel vào đây... (Ctrl+V)"} style={{ ...I, height: 120, resize: "vertical", fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }} />
        {error && <div style={{ color: "#EF4444", fontSize: 12, marginTop: 8, padding: "6px 10px", background: "#FEE2E2", borderRadius: 6 }}>{error}</div>}
        {preview.length > 0 && <>
          <div style={{ marginTop: 12, fontSize: 12, fontWeight: 700, color: "#059669" }}>✅ Xem trước: {preview.length} dòng</div>
          <div style={{ overflowX: "auto", marginTop: 6, borderRadius: 8, border: "1px solid #334155", maxHeight: 260, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead><tr style={{ background: "#0F172A" }}>{["Loại", "Mã", "Tên", "Block", "BP", "TT"].map((h, i) => <th key={i} style={{ padding: "6px 8px", textAlign: "left", color: "#94A3B8", fontSize: 10 }}>{h}</th>)}</tr></thead>
              <tbody>{preview.slice(0, 10).map((it, i) => { const st = getStatusItem(it.type, it.status); return <tr key={i}><td style={{ padding: "5px 8px" }}>{it.type}</td><td style={{ padding: "5px 8px", fontFamily: "'JetBrains Mono'", fontSize: 10 }}>{it.code}</td><td style={{ padding: "5px 8px", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</td><td style={{ padding: "5px 8px" }}>{it.block}</td><td style={{ padding: "5px 8px" }}>{it.dept}</td><td style={{ padding: "5px 8px" }}><Bd c={st?.c} bg={st?.bg}>{st?.l || it.status}</Bd></td></tr>; })}</tbody>
            </table>
            {preview.length > 10 && <div style={{ padding: 8, textAlign: "center", color: "#64748B", fontSize: 11 }}>... và {preview.length - 10} dòng nữa</div>}
          </div>
          <button onClick={() => onImport(preview)} style={{ marginTop: 10, padding: "10px 24px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#059669,#0D9488)", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", width: "100%" }}>✅ Nhập {preview.length} bản ghi</button>
        </>}
      </div>
    </div>);
}

// ─── Export Menu ───
function ExportMenu({ items, stats, onClose }) {
  const downloadCSV = (type) => { const csv = itemsToCSV(items, type); const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `${type || "all"}_${td()}.csv`; a.click(); URL.revokeObjectURL(url); };
  const downloadBoth = () => { downloadCSV("SD"); setTimeout(() => downloadCSV("RFI"), 500); };
  const openGoogleSheet = () => { downloadCSV(null); setTimeout(() => window.open("https://sheets.new", "_blank"), 500); };
  const previewReport = () => { const html = generateReportHTML(items, stats); const w = window.open("", "_blank"); w.document.write(html); w.document.close(); };
  const downloadReport = () => { const html = generateReportHTML(items, stats); const blob = new Blob([html], { type: "text/html;charset=utf-8" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `report_${td()}.html`; a.click(); URL.revokeObjectURL(url); };
  const B = { display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderRadius: 8, border: "1px solid #334155", background: "#0F172A", color: "#F1F5F9", cursor: "pointer", textAlign: "left", width: "100%" };
  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.7)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div style={{ background: "#1E293B", borderRadius: 12, padding: 20, width: "100%", maxWidth: 420 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}><h2 style={{ fontSize: 16, fontWeight: 800 }}>📤 Xuất dữ liệu</h2><button onClick={onClose} style={{ background: "none", border: "none", color: "#64748B", fontSize: 18, cursor: "pointer" }}>✕</button></div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button onClick={() => downloadCSV(null)} style={B}><span style={{ fontSize: 24 }}>📋</span><div><div style={{ fontWeight: 700, fontSize: 13 }}>Tải CSV đầy đủ</div><div style={{ fontSize: 11, color: "#64748B" }}>Tất cả SD + RFI trong 1 file</div></div></button>
          <button onClick={downloadBoth} style={B}><span style={{ fontSize: 24 }}>📂</span><div><div style={{ fontWeight: 700, fontSize: 13 }}>Tải CSV tách riêng SD & RFI</div><div style={{ fontSize: 11, color: "#64748B" }}>Tải 2 file .csv riêng — SD và RFI</div></div></button>
          <button onClick={openGoogleSheet} style={B}><span style={{ fontSize: 24 }}>📋</span><div><div style={{ fontWeight: 700, fontSize: 13 }}>Xuất Google Sheets</div><div style={{ fontSize: 11, color: "#64748B" }}>Tải CSV + mở Google Sheets mới</div></div></button>
          <button onClick={previewReport} style={B}><span style={{ fontSize: 24 }}>🌐</span><div><div style={{ fontWeight: 700, fontSize: 13 }}>Xem báo cáo HTML</div><div style={{ fontSize: 11, color: "#64748B" }}>Mở tab mới — in PDF bằng Ctrl+P</div></div></button>
          <button onClick={downloadReport} style={B}><span style={{ fontSize: 24 }}>💾</span><div><div style={{ fontWeight: 700, fontSize: 13 }}>Tải báo cáo HTML</div><div style={{ fontSize: 11, color: "#64748B" }}>Tải file .html để gửi email</div></div></button>
        </div>
      </div>
    </div>);
}

// ─── User Management Modal ───
function UserManageModal({ onClose }) {
  const [users, setUsers] = useState({});
  const [newUser, setNewUser] = useState({ username: "", password: "", role: "viewer", displayName: "" });
  const [error, setError] = useState("");

  useEffect(() => {
    const usersRef = ref(db, USERS_REF);
    const unsub = onValue(usersRef, (snap) => {
      setUsers(snap.val() || {});
    });
    return () => unsub();
  }, []);

  const addUser = () => {
    if (!newUser.username.trim() || !newUser.password.trim()) { setError("Tên đăng nhập và mật khẩu không được trống"); return; }
    if (users[newUser.username.trim().toLowerCase()]) { setError("Tên đăng nhập đã tồn tại"); return; }
    const key = newUser.username.trim().toLowerCase();
    set(ref(db, `${USERS_REF}/${key}`), { ...newUser, username: key });
    setNewUser({ username: "", password: "", role: "viewer", displayName: "" });
    setError("");
  };

  const deleteUser = (username) => {
    if (username === "admin") return;
    if (window.confirm(`Xóa user "${username}"?`)) {
      remove(ref(db, `${USERS_REF}/${username}`));
    }
  };

  const changeRole = (username, newRole) => {
    if (username === "admin") return;
    update(ref(db, `${USERS_REF}/${username}`), { role: newRole });
  };

  const I = { padding: "8px 10px", borderRadius: 7, border: "1px solid #334155", background: "#0F172A", color: "#F1F5F9", fontSize: 12 };
  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.7)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div style={{ background: "#1E293B", borderRadius: 12, padding: 20, width: "100%", maxWidth: 600, maxHeight: "80vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h2 style={{ fontSize: 16, fontWeight: 800 }}>👥 Quản lý người dùng</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#64748B", fontSize: 18, cursor: "pointer" }}>✕</button>
        </div>

        {/* Add new user */}
        <div style={{ background: "#0F172A", borderRadius: 8, padding: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#94A3B8", marginBottom: 8 }}>Thêm người dùng mới</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <input placeholder="Tên đăng nhập" value={newUser.username} onChange={e => setNewUser(p => ({ ...p, username: e.target.value }))} style={{ ...I, width: "100%" }} />
            <input placeholder="Mật khẩu" value={newUser.password} onChange={e => setNewUser(p => ({ ...p, password: e.target.value }))} style={{ ...I, width: "100%" }} />
            <input placeholder="Tên hiển thị" value={newUser.displayName} onChange={e => setNewUser(p => ({ ...p, displayName: e.target.value }))} style={{ ...I, width: "100%" }} />
            <select value={newUser.role} onChange={e => setNewUser(p => ({ ...p, role: e.target.value }))} style={{ ...I, width: "100%" }}>
              {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v.l}</option>)}
            </select>
          </div>
          {error && <div style={{ color: "#EF4444", fontSize: 11, marginTop: 6 }}>{error}</div>}
          <button onClick={addUser} style={{ marginTop: 8, padding: "8px 20px", borderRadius: 7, border: "none", background: "#059669", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>+ Thêm</button>
        </div>

        {/* User list */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {Object.entries(users).map(([key, u]) => {
            const roleInfo = ROLES[u.role] || ROLES.viewer;
            return (
              <div key={key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "#0F172A", borderRadius: 7 }}>
                <div style={{ width: 32, height: 32, borderRadius: "50%", background: roleInfo.bg, color: roleInfo.c, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800 }}>
                  {(u.displayName || u.username || "?")[0].toUpperCase()}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{u.displayName || u.username}</div>
                  <div style={{ fontSize: 10, color: "#64748B" }}>@{u.username}</div>
                </div>
                <select value={u.role} onChange={e => changeRole(key, e.target.value)} disabled={key === "admin"} style={{ ...I, width: "auto", opacity: key === "admin" ? 0.5 : 1 }}>
                  {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v.l}</option>)}
                </select>
                <Bd c={roleInfo.c} bg={roleInfo.bg}>{roleInfo.l}</Bd>
                {key !== "admin" && <button onClick={() => deleteUser(key)} style={{ background: "none", border: "none", color: "#EF4444", cursor: "pointer", fontSize: 14 }}>🗑</button>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Login Screen ───
function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) { setError("Vui lòng nhập đầy đủ thông tin"); return; }
    setLoading(true);
    setError("");

    // Check Firebase users DB
    const usersRef = ref(db, USERS_REF);
    onValue(usersRef, (snap) => {
      let users = snap.val();
      // Init default users if empty
      if (!users) {
        set(ref(db, USERS_REF), DEFAULT_USERS);
        users = DEFAULT_USERS;
      }
      const key = username.trim().toLowerCase();
      const user = users[key];
      if (!user) {
        setError("Tên đăng nhập không tồn tại");
        setLoading(false);
        return;
      }
      if (user.password !== password) {
        setError("Mật khẩu không đúng");
        setLoading(false);
        return;
      }
      onLogin({ username: key, role: user.role, displayName: user.displayName || key });
      setLoading(false);
    }, { onlyOnce: true });
  };

  const handleKeyDown = (e) => { if (e.key === "Enter") handleLogin(); };

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#0F172A", flexDirection: "column", gap: 0 }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap');*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Plus Jakarta Sans',sans-serif}`}</style>
      <div style={{ textAlign: "center", width: "100%", maxWidth: 360, padding: "0 20px" }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>📐</div>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: "#F1F5F9", marginBottom: 6 }}>SD & RFI Tracker</h1>
        <p style={{ fontSize: 13, color: "#64748B", marginBottom: 28 }}>Wealthcons · Quản lý Shop Drawing & RFI</p>

        <div style={{ background: "#1E293B", borderRadius: 12, padding: 24 }}>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: "#64748B", marginBottom: 4, textAlign: "left" }}>Tên đăng nhập</div>
            <input value={username} onChange={e => setUsername(e.target.value)} onKeyDown={handleKeyDown} placeholder="Nhập tên đăng nhập" style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #334155", background: "#0F172A", color: "#F1F5F9", fontSize: 13, width: "100%", outline: "none" }} autoFocus />
          </div>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: "#64748B", marginBottom: 4, textAlign: "left" }}>Mật khẩu</div>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={handleKeyDown} placeholder="Nhập mật khẩu" style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #334155", background: "#0F172A", color: "#F1F5F9", fontSize: 13, width: "100%", outline: "none" }} />
          </div>

          {error && <div style={{ color: "#EF4444", fontSize: 12, marginBottom: 10, padding: "6px 10px", background: "#FEE2E2", borderRadius: 6, textAlign: "left" }}>{error}</div>}

          <button onClick={handleLogin} disabled={loading} style={{ padding: "12px 0", borderRadius: 10, border: "none", background: "linear-gradient(135deg, #3B82F6, #8B5CF6)", color: "#fff", fontSize: 15, fontWeight: 700, cursor: loading ? "wait" : "pointer", width: "100%", opacity: loading ? 0.7 : 1 }}>
            {loading ? "Đang đăng nhập..." : "🔐 Đăng nhập"}
          </button>

          <div style={{ marginTop: 14, fontSize: 10, color: "#475569", lineHeight: 1.6 }}>
            Mặc định: admin / admin123
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main App ───
export default function App() {
  const [currentUser, setCurrentUser] = useState(null); // { username, role, displayName }
  const [items, setItems] = useState([]); const [ok, setOk] = useState(false);
  const [view, setView] = useState("dash"); const [editId, setEditId] = useState(null);
  const [detId, setDetId] = useState(null); const [tab, setTab] = useState("SD");
  const [fl, setFl] = useState({ st: "ALL", rk: "ALL", bl: "ALL", ct: "ALL", wh: "ALL", fl: "ALL", dp: "ALL", q: "" });
  const [dashFl, setDashFl] = useState({ bl: "ALL", fl: "ALL", ct: "ALL", dp: "ALL" });
  const [showImport, setShowImport] = useState(false); const [showExport, setShowExport] = useState(false);
  const [showUserMgmt, setShowUserMgmt] = useState(false);
  const [toast, setToast] = useState(null);
  const [sortCol, setSortCol] = useState(null); const [sortDir, setSortDir] = useState("asc");
  const [selected, setSelected] = useState(new Set());
  const [lastSelId, setLastSelId] = useState(null);
  const [dashTab, setDashTab] = useState("overview"); // overview, kpi, actions, trends
  const showToast = (msg, type = "success") => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

  const userRole = currentUser?.role || "viewer";
  const canDel = canDelete(userRole);
  const canEd = canEdit(userRole);
  const canImp = canImport(userRole);

  // Check saved session
  useEffect(() => {
    const saved = sessionStorage.getItem("sd_rfi_user");
    if (saved) {
      try { setCurrentUser(JSON.parse(saved)); } catch { }
    }
  }, []);

  const handleLogin = (user) => {
    setCurrentUser(user);
    sessionStorage.setItem("sd_rfi_user", JSON.stringify(user));
  };

  const handleLogout = () => {
    setCurrentUser(null);
    sessionStorage.removeItem("sd_rfi_user");
    setItems([]);
    setOk(false);
  };

  useEffect(() => {
    if (!currentUser) return;
    const itemsRef = ref(db, ITEMS_REF);
    const unsub = onValue(itemsRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const arr = Object.values(data).map(it => {
          const x = { ...it };
          if (x.type === "RFI") {
            x.status = normRfiStatus(x.status);
          } else {
            if (["DA_DUYET", "DUYET_GC"].includes(x.status) && !x.approveDate) {
              x.approveDate = x.actualDate || x.planDate || "";
            }
          }
          return x;
        });
        setItems(arr);
      } else {
        const s = samples(); writeAllItems(s); setItems(s);
      }
      setOk(true);
    });
    return () => unsub();
  }, [currentUser]);

  const isDup = useCallback((code, excludeId = null) => {
    if (!code) return false;
    const c = code.trim().toLowerCase();
    return items.some(x => x.id !== excludeId && (x.code || "").trim().toLowerCase() === c);
  }, [items]);

  const sv = useCallback((it) => {
    if (isDup(it.code, it.id)) {
      showToast(`Mã "${it.code}" đã tồn tại!`, "error");
      return;
    }
    writeItem(it); setEditId(null); setView("list");
  }, [isDup]);

  const dl = useCallback((id) => { items.forEach(x => { if ((x.links || []).includes(id)) { updateItem(x.id, { links: (x.links || []).filter(l => l !== id) }); } }); deleteItem(id); if (detId === id) setDetId(null); }, [items, detId]);

  const handleImport = useCallback((newItems) => {
    const seen = new Set();
    const unique = [];
    for (const it of newItems) {
      const k = (it.code || "").trim().toLowerCase();
      if (!it.code || seen.has(k)) continue;
      seen.add(k);
      unique.push(it);
    }
    const existingKeys = new Set(items.map(x => (x.code || "").trim().toLowerCase()));
    const toAdd = unique.filter(it => !existingKeys.has((it.code || "").trim().toLowerCase()));
    const skipped = newItems.length - toAdd.length;
    toAdd.forEach(it => writeItem(it));
    setShowImport(false);
    if (skipped > 0) {
      showToast(`Đã nhập ${toAdd.length} bản ghi · Bỏ qua ${skipped} dòng trùng`, toAdd.length > 0 ? "success" : "error");
    } else {
      showToast(`Đã nhập ${toAdd.length} bản ghi!`);
    }
  }, [items]);

  const handleStatusChange = useCallback((id, newStatus) => {
    updateItem(id, { status: newStatus });
  }, []);

  const uq = useCallback((k) => [...new Set(items.map(i => i[k]).filter(Boolean))].sort(), [items]);
  const bls = useMemo(() => uq("block"), [uq]);
  const cts = useMemo(() => uq("cat"), [uq]);
  const fls = useMemo(() => uq("floor"), [uq]);
  const ppl = useMemo(() => [...new Set([...items.map(i => i.who), ...items.map(i => i.sub)].filter(Boolean))].sort(), [items]);

  const dashItems = useMemo(() => items.filter(it => {
    if (dashFl.bl !== "ALL" && it.block !== dashFl.bl) return false;
    if (dashFl.fl !== "ALL" && it.floor !== dashFl.fl) return false;
    if (dashFl.ct !== "ALL" && it.cat !== dashFl.ct) return false;
    if (dashFl.dp !== "ALL" && it.dept !== dashFl.dp) return false;
    return true;
  }), [items, dashFl]);

  const dashBls = useMemo(() => uq("block"), [uq]);
  const dashFls = useMemo(() => { let b = items; if (dashFl.bl !== "ALL") b = b.filter(i => i.block === dashFl.bl); if (dashFl.dp !== "ALL") b = b.filter(i => i.dept === dashFl.dp); return [...new Set(b.map(i => i.floor).filter(Boolean))].sort(); }, [items, dashFl.bl, dashFl.dp]);
  const dashCts = useMemo(() => { let b = items; if (dashFl.bl !== "ALL") b = b.filter(i => i.block === dashFl.bl); if (dashFl.fl !== "ALL") b = b.filter(i => i.floor === dashFl.fl); if (dashFl.dp !== "ALL") b = b.filter(i => i.dept === dashFl.dp); return [...new Set(b.map(i => i.cat).filter(Boolean))].sort(); }, [items, dashFl.bl, dashFl.fl, dashFl.dp]);

  const flt = useMemo(() => items.filter(it => {
    if (it.type !== tab) return false;
    if (fl.st !== "ALL" && it.status !== fl.st) return false;
    if (fl.rk !== "ALL" && rsk(it) !== fl.rk) return false;
    if (fl.bl !== "ALL" && it.block !== fl.bl) return false;
    if (fl.ct !== "ALL" && it.cat !== fl.ct) return false;
    if (fl.fl !== "ALL" && it.floor !== fl.fl) return false;
    if (fl.dp !== "ALL" && it.dept !== fl.dp) return false;
    if (fl.wh !== "ALL" && it.who !== fl.wh && it.sub !== fl.wh) return false;
    if (fl.q) { const s = fl.q.toLowerCase(); return `${it.code} ${it.name} ${it.block} ${it.floor} ${it.cat} ${it.dept} ${it.who} ${it.sub}`.toLowerCase().includes(s); }
    return true;
  }), [items, tab, fl]);

  const SORT_KEYS_SD = { "Mã": "code", "Tên": "name", "Block": "block", "Tầng": "floor", "BP": "dept", "HM": "cat", "Người vẽ": "who", "Đệ trình": "sub", "TT": "status", "KH nộp": "planDate", "TT nộp": "actualDate", "Trễ trình": "_subDelay", "KH duyệt": "_apprPlan", "TT duyệt": "approveDate", "Delay": "_late" };
  const SORT_KEYS_RFI = { "Mã": "code", "Tên": "name", "Block": "block", "Tầng": "floor", "BP": "dept", "HM": "cat", "Người vẽ": "who", "Đệ trình": "sub", "TT": "status", "TT nộp": "actualDate", "KH đóng": "_apprPlan", "TT đóng": "approveDate", "Delay": "_late", "Nguyên nhân": "rootCause" };
  const SORT_KEYS = tab === "RFI" ? SORT_KEYS_RFI : SORT_KEYS_SD;
  const COL_LABELS = tab === "RFI"
    ? ["Mã", "Tên", "Block", "Tầng", "BP", "HM", "Người vẽ", "Đệ trình", "TT", "TT nộp", "KH đóng", "TT đóng", "Delay", "Nguyên nhân"]
    : ["Mã", "Tên", "Block", "Tầng", "BP", "HM", "Người vẽ", "Đệ trình", "TT", "KH nộp", "TT nộp", "Trễ trình", "KH duyệt", "TT duyệt", "Delay"];
  const toggleSort = (colLabel) => { const key = SORT_KEYS[colLabel]; if (!key) return; if (sortCol === key) { setSortDir(d => d === "asc" ? "desc" : "asc"); } else { setSortCol(key); setSortDir("asc"); } };
  const sorted = useMemo(() => {
    if (!sortCol) return flt;
    return [...flt].sort((a, b) => {
      let va, vb;
      if (sortCol === "_apprPlan") { va = apprPlan(a) || ""; vb = apprPlan(b) || ""; }
      else if (sortCol === "_late") { va = ld(a) ?? -1; vb = ld(b) ?? -1; return sortDir === "asc" ? va - vb : vb - va; }
      else if (sortCol === "_subDelay") { va = subDelay(a) ?? -1; vb = subDelay(b) ?? -1; return sortDir === "asc" ? va - vb : vb - va; }
      else { va = a[sortCol] ?? ""; vb = b[sortCol] ?? ""; }
      if (typeof va === "number" && typeof vb === "number") return sortDir === "asc" ? va - vb : vb - va;
      return sortDir === "asc" ? String(va).localeCompare(String(vb), "vi") : String(vb).localeCompare(String(va), "vi");
    });
  }, [flt, sortCol, sortDir]);

  const toggleSelect = (id, shiftKey = false) => {
    if (shiftKey && lastSelId && lastSelId !== id) {
      const ids = sorted.map(i => i.id);
      const a = ids.indexOf(lastSelId);
      const b = ids.indexOf(id);
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        const range = ids.slice(lo, hi + 1);
        setSelected(prev => { const n = new Set(prev); range.forEach(rid => n.add(rid)); return n; });
        setLastSelId(id);
        return;
      }
    }
    setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    setLastSelId(id);
  };
  const toggleSelectAll = () => { if (sorted.length && sorted.every(i => selected.has(i.id))) setSelected(new Set()); else setSelected(new Set(sorted.map(i => i.id))); };
  const deleteSelected = () => { if (!selected.size || !window.confirm(`Xóa ${selected.size} mục đã chọn?`)) return; selected.forEach(id => dl(id)); setSelected(new Set()); };

  const stats = useMemo(() => {
    const src = dashItems;
    const bS = {}, bR = { late: 0, high: 0, med: 0, ok: 0, done: 0, reject: 0, none: 0 }, bB = {}, bC = {}, bP = {}, bD = {};
    ST.forEach(s => bS[s.k] = 0); ST_RFI.forEach(s => bS[s.k] = 0);
    src.forEach(it => { bS[it.status] = (bS[it.status] || 0) + 1; bR[rsk(it)]++; if (it.block) bB[it.block] = (bB[it.block] || 0) + 1; if (it.cat) bC[it.cat] = (bC[it.cat] || 0) + 1; if (it.who) bP[it.who] = (bP[it.who] || 0) + 1; if (it.dept) bD[it.dept] = (bD[it.dept] || 0) + 1; });
    return { bS, bR, bB, bC, bP, bD, tot: src.length, sd: src.filter(i => i.type === "SD").length, rfi: src.filter(i => i.type === "RFI").length };
  }, [dashItems]);

  const fullStats = useMemo(() => {
    const bS = {}, bR = { late: 0, high: 0, med: 0, ok: 0, done: 0, reject: 0, none: 0 }, bB = {}, bC = {}, bP = {}, bD = {};
    ST.forEach(s => bS[s.k] = 0); ST_RFI.forEach(s => bS[s.k] = 0);
    items.forEach(it => { bS[it.status] = (bS[it.status] || 0) + 1; bR[rsk(it)]++; if (it.block) bB[it.block] = (bB[it.block] || 0) + 1; if (it.cat) bC[it.cat] = (bC[it.cat] || 0) + 1; if (it.who) bP[it.who] = (bP[it.who] || 0) + 1; if (it.dept) bD[it.dept] = (bD[it.dept] || 0) + 1; });
    return { bS, bR, bB, bC, bP, bD, tot: items.length, sd: items.filter(i => i.type === "SD").length, rfi: items.filter(i => i.type === "RFI").length };
  }, [items]);

  const alerts = useMemo(() => dashItems.filter(i => ["late", "high"].includes(rsk(i))).sort((a, b) => (rsk(a) === "late" ? 0 : 1) - (rsk(b) === "late" ? 0 : 1) || (a.planDate || "").localeCompare(b.planDate || "")), [dashItems]);

  const sdItemsDash = useMemo(() => dashItems.filter(i => i.type === "SD"), [dashItems]);
  const rfiItemsDash = useMemo(() => dashItems.filter(i => i.type === "RFI"), [dashItems]);
  const openItems = useMemo(() => dashItems.filter(i => !isDone(i) && i.planDate), [dashItems]);
  const aging = useMemo(() => {
    const buckets = [0, 0, 0, 0];
    openItems.forEach(it => { const d = dd(td(), it.planDate); if (d === null || d <= 0) return; if (d <= 3) buckets[0]++; else if (d <= 7) buckets[1]++; else if (d <= 14) buckets[2]++; else buckets[3]++; });
    return buckets;
  }, [openItems]);
  const avgReview = useMemo(() => {
    const completed = dashItems.filter(i => i.actualDate && i.planDate);
    if (!completed.length) return { all: 0, civ: 0, mep: 0 };
    const calc = (list) => { if (!list.length) return 0; const sum = list.reduce((s, i) => s + Math.abs(dd(i.actualDate, i.planDate) || 0), 0); return Math.round(sum / list.length * 10) / 10; };
    return { all: calc(completed), civ: calc(completed.filter(i => i.dept === "CIV")), mep: calc(completed.filter(i => i.dept === "MEP")) };
  }, [dashItems]);

  // === NEW: Trend data ===
  const trendData = useMemo(() => {
    const rfiItems = dashItems.filter(i => i.type === "RFI");
    const weekMap = {};
    // Collect all weeks
    rfiItems.forEach(it => {
      const openWeek = getWeekKey(it.actualDate);
      const closeWeek = getWeekKey(it.approveDate);
      if (openWeek) weekMap[openWeek] = weekMap[openWeek] || { opened: 0, closed: 0 };
      if (closeWeek) weekMap[closeWeek] = weekMap[closeWeek] || { opened: 0, closed: 0 };
      if (openWeek) weekMap[openWeek].opened++;
      if (closeWeek) weekMap[closeWeek].closed++;
    });
    const weeks = Object.keys(weekMap).sort().slice(-8);
    if (weeks.length < 2) return null;
    return {
      labels: weeks.map(getWeekLabel),
      series: [
        { color: "#3B82F6", label: "RFI mở mới", values: weeks.map(w => weekMap[w]?.opened || 0) },
        { color: "#059669", label: "RFI đã đóng", values: weeks.map(w => weekMap[w]?.closed || 0) },
      ],
    };
  }, [dashItems]);

  // === NEW: Root Cause analysis ===
  const rootCauseData = useMemo(() => {
    const rfiItems = dashItems.filter(i => i.type === "RFI" && i.rootCause);
    const counts = {};
    rfiItems.forEach(it => { counts[it.rootCause] = (counts[it.rootCause] || 0) + 1; });
    return ROOT_CAUSES.filter(rc => counts[rc.k]).map(rc => ({ ...rc, count: counts[rc.k] || 0 })).sort((a, b) => b.count - a.count);
  }, [dashItems]);

  // === NEW: Response time analysis ===
  const responseTimeAnalysis = useMemo(() => {
    const rfiItems = dashItems.filter(i => i.type === "RFI");
    const closedRFIs = rfiItems.filter(i => normRfiStatus(i.status) === "CLOSED" && i.actualDate && i.approveDate);
    if (!closedRFIs.length) return { avgResponseTime: 0, byOwner: {} };
    const totalDays = closedRFIs.reduce((s, i) => s + Math.abs(dd(i.approveDate, i.actualDate) || 0), 0);
    const avgResponseTime = Math.round(totalDays / closedRFIs.length * 10) / 10;
    // By action owner
    const byOwner = {};
    closedRFIs.forEach(it => {
      const owner = it.actionOwner || "Chưa phân";
      if (!byOwner[owner]) byOwner[owner] = { total: 0, count: 0 };
      byOwner[owner].total += Math.abs(dd(it.approveDate, it.actualDate) || 0);
      byOwner[owner].count++;
    });
    Object.keys(byOwner).forEach(k => { byOwner[k].avg = Math.round(byOwner[k].total / byOwner[k].count * 10) / 10; });
    return { avgResponseTime, byOwner };
  }, [dashItems]);

  // === NEW: KPI calculations ===
  const kpiData = useMemo(() => {
    const rfiItems = dashItems.filter(i => i.type === "RFI");
    const closedRFIs = rfiItems.filter(i => normRfiStatus(i.status) === "CLOSED");
    const rfiOnTime = closedRFIs.filter(i => { const l2 = ld(i); return l2 !== null && l2 <= 0; }).length;
    const rfiOnTimePct = closedRFIs.length ? Math.round(rfiOnTime / closedRFIs.length * 100) : 0;

    const sdItems = dashItems.filter(i => i.type === "SD");
    const sdDone = sdItems.filter(i => isDone(i));
    const sdFirstPass = sdDone.filter(i => i.rev === 0).length;
    const sdFirstPassPct = sdDone.length ? Math.round(sdFirstPass / sdDone.length * 100) : 0;

    const lateOnCritical = dashItems.filter(i => rsk(i) === "late" && (i.links || []).length > 0).length;

    return {
      rfiOnTimePct,
      avgResponseTime: responseTimeAnalysis.avgResponseTime,
      sdFirstPassPct,
      lateOnCritical,
      completionPct: stats.tot ? Math.round(dashItems.filter(i => isDone(i)).length / stats.tot * 100) : 0,
    };
  }, [dashItems, stats, responseTimeAnalysis]);

  // === NEW: Action items ===
  const actionItems = useMemo(() => {
    return dashItems
      .filter(i => i.type === "RFI" && normRfiStatus(i.status) === "OPEN")
      .map(it => ({
        ...it,
        actionStatus: it.actionStatus || "IN_PROGRESS",
        actionOwner: it.actionOwner || "Chưa phân",
        actionDeadline: it.actionDeadline || "",
        isOverdue: it.actionDeadline ? dd(td(), it.actionDeadline) > 0 : false,
      }))
      .sort((a, b) => {
        if (a.isOverdue && !b.isOverdue) return -1;
        if (!a.isOverdue && b.isOverdue) return 1;
        return (a.actionDeadline || "").localeCompare(b.actionDeadline || "");
      });
  }, [dashItems]);

  const det = detId ? items.find(x => x.id === detId) : null;
  const eIt = editId === "ns" ? { id: Date.now().toString(36), type: "SD", code: "", name: "", block: "", floor: "", dept: "CIV", cat: "", who: "", sub: "", status: "DANG_VE", planDate: "", actualDate: "", approveDate: "", offset: 7, rev: 0, links: [], notes: [], rootCause: "", actionStatus: "", actionOwner: "", actionDeadline: "" } : editId === "nr" ? { id: Date.now().toString(36), type: "RFI", code: "", name: "", block: "", floor: "", dept: "CIV", cat: "", who: "", sub: "", status: "OPEN", planDate: "", actualDate: "", approveDate: "", offset: 3, rev: 0, links: [], notes: [], rootCause: "", actionStatus: "", actionOwner: "", actionDeadline: "" } : items.find(x => x.id === editId);

  // Auth check
  if (!currentUser) return <LoginScreen onLogin={handleLogin} />;
  if (!ok) return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#0F172A", color: "#F1F5F9" }}>Đang đồng bộ dữ liệu...</div>;

  const done = dashItems.filter(i => isDone(i)).length;
  const pct = stats.tot ? Math.round(done / stats.tot * 100) : 0;
  const sData = ST.map(s => ({ l: s.l, v: stats.bS[s.k] || 0, c: s.c }));
  const rData = Object.entries(RC).filter(([k]) => k !== "none").map(([k, v]) => ({ l: v.l, v: stats.bR[k] || 0, c: v.c }));

  const sdApproved = sdItemsDash.filter(i => isDone(i)).length;
  const sdPending = sdItemsDash.filter(i => !isDone(i) && i.status !== "REJECT").length;
  const sdOverdue = sdItemsDash.filter(i => rsk(i) === "late").length;
  const rfiClosed = rfiItemsDash.filter(i => isDone(i)).length;
  const rfiOpen = rfiItemsDash.filter(i => !isDone(i)).length;
  const rfiOverdue = rfiItemsDash.filter(i => rsk(i) === "late").length;
  const totalOverdue = stats.bR.late;
  const sdPct2 = sdItemsDash.length ? Math.round(sdApproved / sdItemsDash.length * 100) : 0;
  const sdPendPct = sdItemsDash.length ? Math.round(sdPending / sdItemsDash.length * 100) : 0;
  const sdOverduePct = sdItemsDash.length ? Math.round(sdOverdue / sdItemsDash.length * 100) : 0;
  const rfiClosedPct = rfiItemsDash.length ? Math.round(rfiClosed / rfiItemsDash.length * 100) : 0;
  const rfiOpenPct = rfiItemsDash.length ? Math.round(rfiOpen / rfiItemsDash.length * 100) : 0;
  const rfiOverduePct = rfiItemsDash.length ? Math.round(rfiOverdue / rfiItemsDash.length * 100) : 0;

  const ss = { padding: "5px 9px", borderRadius: 7, border: "1px solid #334155", background: "#1E293B", color: "#F1F5F9", fontSize: 12 };
  const hasDashFilter = dashFl.bl !== "ALL" || dashFl.fl !== "ALL" || dashFl.ct !== "ALL" || dashFl.dp !== "ALL";
  const roleInfo = ROLES[userRole] || ROLES.viewer;

  return (<>
    <style>{`@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap');*{box-sizing:border-box;margin:0;padding:0}body{background:#0F172A;color:#F1F5F9;font-family:'Plus Jakarta Sans',sans-serif}input,select,textarea{font-family:inherit}::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:#334155;border-radius:2px}`}</style>
    {toast && <div style={{ position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 3000, padding: "10px 20px", borderRadius: 8, background: toast.type === "success" ? "#059669" : "#DC2626", color: "#fff", fontSize: 13, fontWeight: 600, boxShadow: "0 4px 20px rgba(0,0,0,.4)" }}>{toast.msg}</div>}
    <div style={{ minHeight: "100vh", background: "#0F172A", padding: "12px 16px", maxWidth: 1400, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
        <div><h1 style={{ fontSize: 19, fontWeight: 800, letterSpacing: -.5 }}>📐 SD & RFI Tracker</h1><p style={{ fontSize: 11, color: "#64748B" }}>Wealthcons · {fullStats.sd} SD · {fullStats.rfi} RFI · CIV:{items.filter(i=>i.dept==="CIV").length} · MEP:{items.filter(i=>i.dept==="MEP").length}</p></div>
        <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
          {[["dash", "📊 Tổng quan"], ["list", "📋 Danh sách"]].map(([k, l]) => <button key={k} onClick={() => { setView(k); setDetId(null); setEditId(null); }} style={{ padding: "6px 14px", borderRadius: 7, border: "1px solid", fontSize: 12, fontWeight: 600, cursor: "pointer", borderColor: view === k ? "#3B82F6" : "#334155", background: view === k ? "#3B82F6" : "transparent", color: view === k ? "#fff" : "#64748B" }}>{l}</button>)}
          {canEd && <button onClick={() => { setEditId("ns"); setView("form"); }} style={{ padding: "6px 12px", borderRadius: 7, border: "none", background: "linear-gradient(135deg,#3B82F6,#8B5CF6)", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>+ SD</button>}
          {canEd && <button onClick={() => { setEditId("nr"); setView("form"); }} style={{ padding: "6px 12px", borderRadius: 7, border: "none", background: "linear-gradient(135deg,#8B5CF6,#EC4899)", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>+ RFI</button>}
          {canImp && <button onClick={() => setShowImport(true)} style={{ padding: "6px 10px", borderRadius: 7, border: "1px solid #334155", background: "transparent", color: "#059669", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>📥 Import</button>}
          <button onClick={() => setShowExport(true)} style={{ padding: "6px 10px", borderRadius: 7, border: "1px solid #334155", background: "transparent", color: "#0EA5E9", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>📤 Export</button>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 4 }}>
            <div style={{ width: 26, height: 26, borderRadius: "50%", background: roleInfo.bg, color: roleInfo.c, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800 }}>
              {(currentUser.displayName || currentUser.username)[0].toUpperCase()}
            </div>
            <div>
              <span style={{ fontSize: 11, color: "#94A3B8" }}>{currentUser.displayName || currentUser.username}</span>
              <Bd c={roleInfo.c} bg={roleInfo.bg}>{roleInfo.l}</Bd>
            </div>
            {userRole === "owner" && <button onClick={() => setShowUserMgmt(true)} style={{ padding: "4px 8px", borderRadius: 5, border: "1px solid #334155", background: "transparent", color: "#F59E0B", fontSize: 10, cursor: "pointer" }}>👥</button>}
            <button onClick={handleLogout} style={{ padding: "4px 8px", borderRadius: 5, border: "1px solid #334155", background: "transparent", color: "#EF4444", fontSize: 10, cursor: "pointer" }}>Đăng xuất</button>
          </div>
        </div>
      </div>

      {/* Modals */}
      {det && <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.6)", zIndex: 1000, display: "flex", justifyContent: "flex-end" }} onClick={() => setDetId(null)}>
        <div style={{ width: 420, maxWidth: "90vw", height: "100vh", background: "#1E293B", padding: "18px 20px", overflowY: "auto", boxShadow: "-4px 0 24px rgba(0,0,0,.4)" }} onClick={e => e.stopPropagation()}>
          <Detail item={det} items={items} canDel={canDel} canEd={canEd} onClose={() => setDetId(null)} onEdit={() => { setEditId(det.id); setView("form"); setDetId(null); }}
            onLink={tid => { updateItem(det.id, { links: [...new Set([...(det.links || []), tid])] }); const t = items.find(x => x.id === tid); updateItem(tid, { links: [...new Set([...(t?.links || []), det.id])] }); }}
            onUnlink={tid => { updateItem(det.id, { links: (det.links || []).filter(i => i !== tid) }); updateItem(tid, { links: ((items.find(x => x.id === tid)?.links) || []).filter(i => i !== det.id) }); }}
            onNote={(t, file) => { const n = { id: Date.now().toString(36), t, d: td(), h: new Date().toLocaleTimeString("vi", { hour: "2-digit", minute: "2-digit" }) }; if (file) n.file = file; updateItem(det.id, { notes: [...(det.notes || []), n] }); }}
            onDelNote={nid => { updateItem(det.id, { notes: (det.notes || []).filter(n => n.id !== nid) }); }}
            onDel={() => dl(det.id)} onGo={id => setDetId(id)} />
        </div>
      </div>}

      {showImport && <ImportModal onImport={handleImport} onClose={() => setShowImport(false)} />}
      {showExport && <ExportMenu items={items} stats={fullStats} onClose={() => setShowExport(false)} />}
      {showUserMgmt && <UserManageModal onClose={() => setShowUserMgmt(false)} />}

      {/* ═══════════════ DASHBOARD ═══════════════ */}
      {view === "dash" && <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {/* Filter bar */}
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", padding: "8px 12px", background: "#1E293B", borderRadius: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#64748B", marginRight: 4 }}>🔍 Lọc:</span>
          <select value={dashFl.dp} onChange={e => setDashFl(f => ({ ...f, dp: e.target.value, ct: "ALL" }))} style={ss}><option value="ALL">Tất cả BP</option>{DEPTS.map(d => <option key={d.k} value={d.k}>{d.l}</option>)}</select>
          <select value={dashFl.bl} onChange={e => setDashFl(f => ({ ...f, bl: e.target.value, fl: "ALL", ct: "ALL" }))} style={ss}><option value="ALL">Tất cả Block</option>{dashBls.map(b => <option key={b}>{b}</option>)}</select>
          <select value={dashFl.fl} onChange={e => setDashFl(f => ({ ...f, fl: e.target.value, ct: "ALL" }))} style={ss}><option value="ALL">Tất cả Tầng</option>{dashFls.map(f => <option key={f}>{f}</option>)}</select>
          <select value={dashFl.ct} onChange={e => setDashFl(f => ({ ...f, ct: e.target.value }))} style={ss}><option value="ALL">Tất cả HM</option>{dashCts.map(c => <option key={c}>{c}</option>)}</select>
          {hasDashFilter && <><button onClick={() => setDashFl({ bl: "ALL", fl: "ALL", ct: "ALL", dp: "ALL" })} style={{ ...ss, color: "#F87171", border: "1px solid #F87171", cursor: "pointer", fontSize: 11 }}>✕ Xóa lọc</button><span style={{ fontSize: 10, color: "#64748B" }}>({dashItems.length}/{items.length})</span></>}
          <div style={{ flex: 1 }} />
          {/* Dashboard sub-tabs */}
          {["overview", "kpi", "trends", "actions"].map(t => (
            <button key={t} onClick={() => setDashTab(t)} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid", fontSize: 10, fontWeight: 600, cursor: "pointer", borderColor: dashTab === t ? "#3B82F6" : "#334155", background: dashTab === t ? "#3B82F6" : "transparent", color: dashTab === t ? "#fff" : "#64748B" }}>
              {{ overview: "📊 Tổng quan", kpi: "🎯 KPI", trends: "📈 Xu hướng", actions: "📋 Hành động" }[t]}
            </button>
          ))}
        </div>

        {/* ── OVERVIEW TAB ── */}
        {dashTab === "overview" && <>
          {/* ROW 1: Summary Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
            <div style={{ background: "#1E293B", borderRadius: 10, padding: "16px 18px", borderTop: "3px solid #2563EB" }}>
              <div style={{ fontSize: 11, color: "#94A3B8", fontWeight: 600, marginBottom: 6 }}>📐 Shop Drawings (SDs)</div>
              <div style={{ fontSize: 32, fontWeight: 800, color: "#3B82F6", fontFamily: "'JetBrains Mono'", marginBottom: 10 }}>{sdItemsDash.length} <span style={{ fontSize: 13, fontWeight: 600, color: "#94A3B8" }}>Tổng</span></div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}><span style={{ color: "#059669" }}>✅</span><span style={{ color: "#CBD5E1" }}>{sdPct2}% Đã duyệt</span></div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}><span style={{ color: "#D97706" }}>⏳</span><span style={{ color: "#CBD5E1" }}>{sdPendPct}% Đang xử lý</span></div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}><span style={{ color: "#DC2626" }}>🔴</span><span style={{ color: "#CBD5E1" }}>{sdOverduePct}% Trễ hạn</span></div>
              </div>
            </div>
            <div style={{ background: "#1E293B", borderRadius: 10, padding: "16px 18px", borderTop: "3px solid #7C3AED" }}>
              <div style={{ fontSize: 11, color: "#94A3B8", fontWeight: 600, marginBottom: 6 }}>📝 RFIs</div>
              <div style={{ fontSize: 32, fontWeight: 800, color: "#8B5CF6", fontFamily: "'JetBrains Mono'", marginBottom: 10 }}>{rfiItemsDash.length} <span style={{ fontSize: 13, fontWeight: 600, color: "#94A3B8" }}>Tổng</span></div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}><span style={{ color: "#059669" }}>✅</span><span style={{ color: "#CBD5E1" }}>{rfiClosedPct}% Đã đóng</span></div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}><span style={{ color: "#D97706" }}>⏳</span><span style={{ color: "#CBD5E1" }}>{rfiOpenPct}% Đang mở</span></div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}><span style={{ color: "#DC2626" }}>🔴</span><span style={{ color: "#CBD5E1" }}>{rfiOverduePct}% Trễ hạn</span></div>
              </div>
            </div>
            <div style={{ background: "#1E293B", borderRadius: 10, padding: "16px 18px", borderTop: "3px solid #DC2626" }}>
              <div style={{ fontSize: 11, color: "#94A3B8", fontWeight: 600, marginBottom: 6 }}>⚠️ Trễ hạn</div>
              <div style={{ fontSize: 32, fontWeight: 800, color: "#DC2626", fontFamily: "'JetBrains Mono'", marginBottom: 10 }}>{totalOverdue} <span style={{ fontSize: 13, fontWeight: 600, color: "#94A3B8" }}>Tổng</span></div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}><span>📐</span><span style={{ color: "#CBD5E1" }}>{sdOverdue} SDs</span></div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}><span>📝</span><span style={{ color: "#CBD5E1" }}>{rfiOverdue} RFIs</span></div>
              </div>
            </div>
            <div style={{ background: "#1E293B", borderRadius: 10, padding: "16px 18px", borderTop: "3px solid #0891B2" }}>
              <div style={{ fontSize: 11, color: "#94A3B8", fontWeight: 600, marginBottom: 6 }}>📊 Tổng quan</div>
              <div style={{ fontSize: 32, fontWeight: 800, color: "#0EA5E9", fontFamily: "'JetBrains Mono'", marginBottom: 10 }}>{pct}% <span style={{ fontSize: 13, fontWeight: 600, color: "#94A3B8" }}>Hoàn thành</span></div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}><span>🏗️</span><span style={{ color: "#CBD5E1" }}>CIV: {dashItems.filter(i => i.dept === "CIV").length}</span></div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}><span>⚡</span><span style={{ color: "#CBD5E1" }}>MEP: {dashItems.filter(i => i.dept === "MEP").length}</span></div>
              </div>
            </div>
          </div>

          {/* ROW 2: Status + Risk */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr 1fr", gap: 10 }}>
            <div style={{ background: "#1E293B", borderRadius: 10, padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#CBD5E1", marginBottom: 12, borderBottom: "2px solid #334155", paddingBottom: 6 }}>📐 SD Trạng thái</div>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <Donut data={ST.map(s => ({ l: s.l, v: sdItemsDash.filter(i => i.status === s.k).length, c: s.c }))} size={120} />
                <div style={{ flex: 1 }}>{ST.map((s, i) => { const v = sdItemsDash.filter(it => it.status === s.k).length; if (!v) return null; return <div key={i} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, marginBottom: 3 }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: s.c }} /><span style={{ color: "#94A3B8", flex: 1 }}>{s.l}</span><span style={{ fontWeight: 700, fontFamily: "'JetBrains Mono'", color: "#F1F5F9" }}>{v}</span></div>; })}</div>
              </div>
            </div>
            {/* Root Cause Panel - NEW */}
            <div style={{ background: "#1E293B", borderRadius: 10, padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#CBD5E1", marginBottom: 12, borderBottom: "2px solid #334155", paddingBottom: 6 }}>🔍 Nguyên nhân RFI</div>
              {rootCauseData.length === 0 ? <div style={{ color: "#475569", fontSize: 12, padding: 16, textAlign: "center" }}>Chưa phân loại nguyên nhân</div> :
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {rootCauseData.map((rc, i) => {
                    const totalRC = rootCauseData.reduce((s, r) => s + r.count, 0);
                    const pctRC = totalRC ? Math.round(rc.count / totalRC * 100) : 0;
                    return (
                      <div key={i}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                          <span style={{ fontSize: 11, color: "#94A3B8" }}>{rc.l}</span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: rc.c, fontFamily: "'JetBrains Mono'" }}>{rc.count} ({pctRC}%)</span>
                        </div>
                        <div style={{ height: 6, borderRadius: 3, background: "#0F172A", overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${pctRC}%`, background: rc.c, borderRadius: 3 }} />
                        </div>
                      </div>
                    );
                  })}
                </div>}
            </div>
            <div style={{ background: "#1E293B", borderRadius: 10, padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#CBD5E1", marginBottom: 12, borderBottom: "2px solid #334155", paddingBottom: 6 }}>🎯 Theo rủi ro</div>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <Donut data={rData} size={110} />
                <div style={{ flex: 1 }}>{rData.filter(d => d.v > 0).map((d, i) => <div key={i} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, marginBottom: 3 }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: d.c, flexShrink: 0 }} /><span style={{ color: "#94A3B8", flex: 1 }}>{d.l}</span><span style={{ fontWeight: 700, fontFamily: "'JetBrains Mono'", color: "#F1F5F9" }}>{d.v}</span></div>)}</div>
              </div>
            </div>
          </div>

          {/* Progress bar */}
          <div style={{ background: "#1E293B", borderRadius: 10, padding: "12px 14px" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#94A3B8", marginBottom: 8 }}>📈 Tiến độ chung</div>
            <Seg data={sData} h={24} />
            <div style={{ display: "flex", gap: 10, marginTop: 6, flexWrap: "wrap" }}>{sData.filter(d => d.v > 0).map((d, i) => <span key={i} style={{ fontSize: 10, color: "#94A3B8", display: "flex", alignItems: "center", gap: 3 }}><span style={{ width: 6, height: 6, borderRadius: 2, background: d.c }} />{d.l}({d.v})</span>)}</div>
          </div>

          {/* ROW: Aging + Avg Review + Block/HM/Người vẽ */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <div style={{ background: "#1E293B", borderRadius: 10, padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#CBD5E1", marginBottom: 12, borderBottom: "2px solid #334155", paddingBottom: 6 }}>⏰ Tuổi items trễ</div>
              {(() => {
                const labels = ["0–3 ngày", "4–7 ngày", "8–14 ngày", ">14 ngày"];
                const colors = ["#3B82F6", "#F59E0B", "#EA580C", "#DC2626"];
                const mx = Math.max(...aging, 1);
                return <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-around", height: 120, gap: 6, paddingTop: 10 }}>
                  {aging.map((v, i) => <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1, gap: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: colors[i], fontFamily: "'JetBrains Mono'" }}>{v}</span>
                    <div style={{ width: "100%", maxWidth: 36, height: `${Math.max(v / mx * 80, 4)}px`, background: colors[i], borderRadius: 4 }} />
                    <span style={{ fontSize: 8, color: "#64748B", textAlign: "center", lineHeight: 1.2 }}>{labels[i]}</span>
                  </div>)}
                </div>;
              })()}
            </div>
            <div style={{ background: "#1E293B", borderRadius: 10, padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#CBD5E1", marginBottom: 12, borderBottom: "2px solid #334155", paddingBottom: 6 }}>⏱️ Thời gian xử lý TB (ngày)</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
                {[{ l: "Tất cả", v: avgReview.all, c: "#3B82F6" }, { l: "CIV", v: avgReview.civ, c: "#F59E0B" }, { l: "MEP", v: avgReview.mep, c: "#06B6D4" }].map((r, i) => (
                  <div key={i}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                      <span style={{ fontSize: 11, color: "#94A3B8" }}>{r.l}</span>
                      <span style={{ fontSize: 13, fontWeight: 800, color: r.c, fontFamily: "'JetBrains Mono'" }}>{r.v}</span>
                    </div>
                    <div style={{ height: 8, borderRadius: 4, background: "#0F172A", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${Math.min(r.v / 15 * 100, 100)}%`, background: r.c, borderRadius: 4 }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {/* Response Time by Owner - NEW */}
            <div style={{ background: "#1E293B", borderRadius: 10, padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#CBD5E1", marginBottom: 12, borderBottom: "2px solid #334155", paddingBottom: 6 }}>🔎 Thời gian phản hồi RFI</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: "#3B82F6", fontFamily: "'JetBrains Mono'", marginBottom: 8 }}>{responseTimeAnalysis.avgResponseTime} <span style={{ fontSize: 11, color: "#64748B", fontWeight: 400 }}>ngày TB</span></div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {Object.entries(responseTimeAnalysis.byOwner).map(([owner, data], i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 8px", background: "#0F172A", borderRadius: 6 }}>
                    <span style={{ fontSize: 11, color: "#94A3B8" }}>{owner}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: data.avg > 7 ? "#DC2626" : data.avg > 3 ? "#F59E0B" : "#059669", fontFamily: "'JetBrains Mono'" }}>{data.avg}d ({data.count})</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ROW: Block + HM + Người vẽ */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            {[["Block", Object.entries(stats.bB), "#3B82F6"], ["Hạng mục", Object.entries(stats.bC), "#8B5CF6"], ["Người vẽ", Object.entries(stats.bP).sort((a, b) => b[1] - a[1]).slice(0, 8), "#0EA5E9"]].map(([t, d, c], i) =>
              <div key={i} style={{ background: "#1E293B", borderRadius: 10, padding: 14 }}><div style={{ fontSize: 13, fontWeight: 700, color: "#CBD5E1", marginBottom: 10, borderBottom: "2px solid #334155", paddingBottom: 6 }}>{t}</div>{d.length ? <Bar data={d.map(([k, v]) => ({ l: k, v, c }))} /> : <div style={{ color: "#475569", fontSize: 12, padding: 16, textAlign: "center" }}>Trống</div>}</div>)}
          </div>

          {/* Alerts */}
          <div style={{ background: "#1E293B", borderRadius: 10, padding: 14, borderLeft: "3px solid #EF4444" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#EF4444", marginBottom: 8 }}>⚠️ Cảnh báo ({alerts.length})</div>
            {!alerts.length ? <div style={{ fontSize: 12, color: "#64748B" }}>Không có item trễ 🎉</div> :
              <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 280, overflowY: "auto" }}>
                {alerts.map(it => { const r = rsk(it), rc = RC[r], l = ld(it); return (
                  <div key={it.id} onClick={() => setDetId(it.id)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "#0F172A", borderRadius: 7, cursor: "pointer" }}>
                    <span>{rc.i}</span>
                    <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 12, fontWeight: 600 }}><span style={{ opacity: .5, fontSize: 10, marginRight: 3 }}>{it.type}</span>{it.code} · {it.name}</div><div style={{ fontSize: 10, color: "#64748B" }}>{it.dept} · {it.block} · {it.who} · KH: {fm(it.planDate)}</div></div>
                    {l > 0 && <Bd c={rc.c} bg={rc.bg}>{r === "late" ? `Trễ ${l}d` : "≤3d"}</Bd>}
                  </div>); })}</div>}
          </div>
        </>}

        {/* ── KPI TAB ── */}
        {dashTab === "kpi" && <>
          <div style={{ background: "#1E293B", borderRadius: 10, padding: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#F1F5F9", marginBottom: 4 }}>🎯 Chỉ số KPI</div>
            <div style={{ fontSize: 11, color: "#64748B", marginBottom: 14 }}>Đánh giá hiệu suất xử lý SD & RFI so với target</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
              <KPICard label="Tỷ lệ hoàn thành" value={kpiData.completionPct} target={85} unit="%" icon="📊" />
              <KPICard label="RFI phản hồi đúng hạn" value={kpiData.rfiOnTimePct} target={85} unit="%" icon="⏰" />
              <KPICard label="Thời gian phản hồi TB" value={kpiData.avgResponseTime} target={7} unit=" ngày" icon="⏱️" />
              <KPICard label="SD duyệt lần đầu" value={kpiData.sdFirstPassPct} target={70} unit="%" icon="✅" />
              <KPICard label="Trễ trên đường găng" value={kpiData.lateOnCritical} target={0} unit="" icon="🚨" />
              <KPICard label="RFI đang mở" value={rfiOpen} target={5} unit="" icon="📝" />
            </div>
          </div>
        </>}

        {/* ── TRENDS TAB ── */}
        {dashTab === "trends" && <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {/* RFI Trend */}
            <div style={{ background: "#1E293B", borderRadius: 10, padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#CBD5E1", marginBottom: 12, borderBottom: "2px solid #334155", paddingBottom: 6 }}>📈 Xu hướng RFI theo tuần</div>
              {trendData ? <>
                <TrendChart data={trendData.series} labels={trendData.labels} h={160} />
                <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 8 }}>
                  {trendData.series.map((s, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#94A3B8" }}>
                      <span style={{ width: 12, height: 3, borderRadius: 2, background: s.color }} />
                      {s.label}
                    </div>
                  ))}
                </div>
              </> : <div style={{ color: "#475569", fontSize: 12, padding: 30, textAlign: "center" }}>Cần ít nhất 2 tuần dữ liệu</div>}
            </div>
            {/* Root Cause Breakdown */}
            <div style={{ background: "#1E293B", borderRadius: 10, padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#CBD5E1", marginBottom: 12, borderBottom: "2px solid #334155", paddingBottom: 6 }}>🔍 Phân tích nguyên nhân RFI</div>
              {rootCauseData.length === 0 ? <div style={{ color: "#475569", fontSize: 12, padding: 30, textAlign: "center" }}>Chưa có dữ liệu nguyên nhân</div> : <>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <Donut data={rootCauseData.map(rc => ({ l: rc.l, v: rc.count, c: rc.c }))} size={130} />
                  <div style={{ flex: 1 }}>
                    {rootCauseData.map((rc, i) => {
                      const totalRC = rootCauseData.reduce((s, r) => s + r.count, 0);
                      const pctRC = totalRC ? Math.round(rc.count / totalRC * 100) : 0;
                      return (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, marginBottom: 4 }}>
                          <span style={{ width: 8, height: 8, borderRadius: "50%", background: rc.c, flexShrink: 0 }} />
                          <span style={{ color: "#94A3B8", flex: 1 }}>{rc.l}</span>
                          <span style={{ fontWeight: 700, fontFamily: "'JetBrains Mono'", color: "#F1F5F9" }}>{rc.count} ({pctRC}%)</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div style={{ marginTop: 12, padding: "10px 12px", background: "#0F172A", borderRadius: 8, fontSize: 11, color: "#94A3B8", lineHeight: 1.6 }}>
                  💡 {rootCauseData[0] && `Nguyên nhân chính: "${rootCauseData[0].l}" chiếm ${Math.round(rootCauseData[0].count / rootCauseData.reduce((s, r) => s + r.count, 0) * 100)}% tổng RFI có phân loại`}
                </div>
              </>}
            </div>
          </div>
        </>}

        {/* ── ACTIONS TAB ── */}
        {dashTab === "actions" && <>
          <div style={{ background: "#1E293B", borderRadius: 10, padding: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#F1F5F9", marginBottom: 4 }}>📋 Bảng hành động — RFI đang mở ({actionItems.length})</div>
            <div style={{ fontSize: 11, color: "#64748B", marginBottom: 14 }}>Ai cần làm gì, khi nào — theo dõi follow-up</div>
            {!actionItems.length ? <div style={{ padding: 30, textAlign: "center", color: "#475569", fontSize: 12 }}>Không có RFI đang mở 🎉</div> :
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead><tr style={{ background: "#0F172A" }}>
                    {["", "Mã", "Tên RFI", "Nguyên nhân", "Người chịu TN", "Deadline", "Trạng thái", "Delay"].map((h, i) => (
                      <th key={i} style={{ padding: "8px 6px", textAlign: "left", fontWeight: 600, color: "#94A3B8", whiteSpace: "nowrap", borderBottom: "1px solid #334155", fontSize: 10 }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {actionItems.map(it => {
                      const l = ld(it);
                      const actSt = ACTION_STATUS.find(s => s.k === it.actionStatus) || ACTION_STATUS[2];
                      const rcItem = ROOT_CAUSES.find(rc => rc.k === it.rootCause);
                      return (
                        <tr key={it.id} onClick={() => setDetId(it.id)} style={{ cursor: "pointer", borderBottom: "1px solid #1E293B", background: it.isOverdue ? "rgba(220,38,38,.08)" : "transparent" }}
                          onMouseEnter={e => e.currentTarget.style.background = "#1E293B"} onMouseLeave={e => e.currentTarget.style.background = it.isOverdue ? "rgba(220,38,38,.08)" : "transparent"}>
                          <td style={{ padding: "8px 6px" }}>{it.isOverdue ? "🔴" : "🟡"}</td>
                          <td style={{ padding: "8px 6px", fontWeight: 700, fontFamily: "'JetBrains Mono'", fontSize: 10, whiteSpace: "nowrap" }}>{it.code}</td>
                          <td style={{ padding: "8px 6px", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</td>
                          <td style={{ padding: "8px 6px" }}>{rcItem ? <Bd c={rcItem.c} bg={rcItem.bg}>{rcItem.l}</Bd> : "—"}</td>
                          <td style={{ padding: "8px 6px", fontWeight: 600 }}>{it.actionOwner || "—"}</td>
                          <td style={{ padding: "8px 6px", fontFamily: "'JetBrains Mono'", fontSize: 10, color: it.isOverdue ? "#DC2626" : "#94A3B8" }}>{fmFull(it.actionDeadline)}</td>
                          <td style={{ padding: "8px 6px" }}><Bd c={actSt.c} bg={actSt.bg}>{actSt.l}</Bd></td>
                          <td style={{ padding: "8px 6px" }}>{l > 0 ? <Bd c="#DC2626" bg="#FEE2E2">+{l}d</Bd> : l === 0 ? <span style={{ color: "#64748B" }}>0</span> : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>}
          </div>
        </>}
      </div>}

      {/* ═══════════════ LIST ═══════════════ */}
      {view === "list" && <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", gap: 0, borderBottom: "2px solid #1E293B" }}>
          {["SD", "RFI"].map(t => <button key={t} onClick={() => { setTab(t); setFl(f => ({ ...f, st: "ALL" })); setSelected(new Set()); setLastSelId(null); }} style={{ padding: "7px 18px", border: "none", borderBottom: tab === t ? "3px solid #3B82F6" : "3px solid transparent", background: "transparent", color: tab === t ? "#F1F5F9" : "#64748B", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{t === "SD" ? "📐 SD" : "📝 RFI"}</button>)}
        </div>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          <input placeholder="🔍 Tìm..." value={fl.q} onChange={e => setFl(f => ({ ...f, q: e.target.value }))} style={{ ...ss, flex: 1, minWidth: 100 }} />
          <select value={fl.dp} onChange={e => setFl(f => ({ ...f, dp: e.target.value }))} style={ss}><option value="ALL">Bộ phận</option>{DEPTS.map(d => <option key={d.k} value={d.k}>{d.l}</option>)}</select>
          <select value={fl.bl} onChange={e => setFl(f => ({ ...f, bl: e.target.value }))} style={ss}><option value="ALL">Block</option>{bls.map(b => <option key={b}>{b}</option>)}</select>
          <select value={fl.fl} onChange={e => setFl(f => ({ ...f, fl: e.target.value }))} style={ss}><option value="ALL">Tầng</option>{fls.map(f => <option key={f}>{f}</option>)}</select>
          <select value={fl.ct} onChange={e => setFl(f => ({ ...f, ct: e.target.value }))} style={ss}><option value="ALL">Hạng mục</option>{cts.map(c => <option key={c}>{c}</option>)}</select>
          <select value={fl.wh} onChange={e => setFl(f => ({ ...f, wh: e.target.value }))} style={ss}><option value="ALL">Người</option>{ppl.map(p => <option key={p}>{p}</option>)}</select>
          <select value={fl.st} onChange={e => setFl(f => ({ ...f, st: e.target.value }))} style={ss}><option value="ALL">Trạng thái</option>{getStatusList(tab).map(s => <option key={s.k} value={s.k}>{s.l}</option>)}</select>
          <select value={fl.rk} onChange={e => setFl(f => ({ ...f, rk: e.target.value }))} style={ss}><option value="ALL">Rủi ro</option>{Object.entries(RC).map(([k, v]) => <option key={k} value={k}>{v.i}{v.l}</option>)}</select>
          {Object.values(fl).some(v => v !== "ALL" && v !== "") && <button onClick={() => setFl({ st: "ALL", rk: "ALL", bl: "ALL", ct: "ALL", wh: "ALL", fl: "ALL", dp: "ALL", q: "" })} style={{ ...ss, color: "#F87171", border: "1px solid #F87171", cursor: "pointer" }}>✕</button>}
        </div>
        <div style={{ fontSize: 11, color: "#64748B", display: "flex", alignItems: "center", gap: 8 }}>
          {sorted.length} kết quả
          {selected.size > 0 && canDel && <button onClick={deleteSelected} style={{ padding: "3px 10px", borderRadius: 5, border: "1px solid #7F1D1D", background: "#FEE2E2", color: "#DC2626", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>🗑 Xóa {selected.size} mục</button>}
          {selected.size > 0 && <span style={{ fontSize: 10, color: "#3B82F6" }}>✓ Đã chọn {selected.size}</span>}
          {sortCol && <span style={{ color: "#3B82F6", fontSize: 10 }}>Sắp xếp: {Object.entries(SORT_KEYS).find(([,v]) => v === sortCol)?.[0]} {sortDir === "asc" ? "↑" : "↓"} <button onClick={() => { setSortCol(null); setSortDir("asc"); }} style={{ background: "none", border: "none", color: "#F87171", cursor: "pointer", fontSize: 10 }}>✕</button></span>}
        </div>
        <div style={{ overflowX: "auto", borderRadius: 8, border: "1px solid #1E293B" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead><tr style={{ background: "#1E293B" }}>
              <th style={{ padding: "8px 4px", borderBottom: "1px solid #334155", width: 28 }}><input type="checkbox" checked={sorted.length > 0 && sorted.every(i => selected.has(i.id))} onChange={toggleSelectAll} style={{ cursor: "pointer" }} /></th>
              <th style={{ padding: "8px 4px", borderBottom: "1px solid #334155", width: 20 }}></th>
              {COL_LABELS.map((h, i) => <th key={i} onClick={() => toggleSort(h)} style={{ padding: "8px 4px", textAlign: "left", fontWeight: 600, color: SORT_KEYS[h] ? "#94A3B8" : "#64748B", whiteSpace: "nowrap", borderBottom: "1px solid #334155", fontSize: 10, cursor: SORT_KEYS[h] ? "pointer" : "default", userSelect: "none" }}>{h}{sortCol === SORT_KEYS[h] ? (sortDir === "asc" ? " ↑" : " ↓") : ""}</th>)}
              <th style={{ padding: "8px 4px", borderBottom: "1px solid #334155", fontSize: 10, color: "#64748B" }}>🔗</th>
              <th style={{ padding: "8px 4px", borderBottom: "1px solid #334155", fontSize: 10, color: "#64748B" }}>📝</th>
            </tr></thead>
            <tbody>{!sorted.length ? <tr><td colSpan={COL_LABELS.length + 4} style={{ padding: 30, textAlign: "center", color: "#475569" }}>Không có dữ liệu</td></tr> :
              sorted.map(it => {
                const r = rsk(it), rc = RC[r];
                const stList = getStatusList(it.type);
                const st = stList.find(s => s.k === it.status);
                const l = ld(it);
                const lk = (it.links || []).map(lid => items.find(x => x.id === lid)).filter(Boolean);
                const dpt = DEPTS.find(d => d.k === it.dept);
                const ap = apprPlan(it);
                const rcItem = ROOT_CAUSES.find(rc => rc.k === it.rootCause);
                return <tr key={it.id} style={{ cursor: "pointer", borderBottom: "1px solid #1E293B", background: selected.has(it.id) ? "#1E3A5F" : "transparent" }} onMouseEnter={e => { if (!selected.has(it.id)) e.currentTarget.style.background = "#1E293B"; }} onMouseLeave={e => { if (!selected.has(it.id)) e.currentTarget.style.background = "transparent"; }}>
                  <td style={{ padding: "6px 4px" }} onClick={e => e.stopPropagation()}><input type="checkbox" checked={selected.has(it.id)} onChange={() => {}} onClick={e => { e.stopPropagation(); toggleSelect(it.id, e.shiftKey); }} style={{ cursor: "pointer" }} /></td>
                  <td style={{ padding: "6px 4px" }} onClick={() => setDetId(it.id)}>{rc.i}</td>
                  <td style={{ padding: "6px 4px", fontWeight: 700, fontFamily: "'JetBrains Mono'", fontSize: 10, whiteSpace: "nowrap" }} onClick={() => setDetId(it.id)}>{it.code || "—"}</td>
                  <td style={{ padding: "6px 4px", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} onClick={() => setDetId(it.id)}>{it.name || "—"}</td>
                  <td style={{ padding: "6px 4px" }} onClick={() => setDetId(it.id)}>{it.block || "—"}</td>
                  <td style={{ padding: "6px 4px" }} onClick={() => setDetId(it.id)}>{it.floor || "—"}</td>
                  <td style={{ padding: "6px 4px" }} onClick={() => setDetId(it.id)}><Bd c={dpt?.c || "#6B7280"} bg={dpt?.bg || "#F3F4F6"}>{it.dept || "—"}</Bd></td>
                  <td style={{ padding: "6px 4px" }} onClick={() => setDetId(it.id)}>{it.cat || "—"}</td>
                  <td style={{ padding: "6px 4px" }} onClick={() => setDetId(it.id)}>{it.who || "—"}</td>
                  <td style={{ padding: "6px 4px" }} onClick={() => setDetId(it.id)}>{it.sub || "—"}</td>
                  <td style={{ padding: "6px 4px" }} onClick={e => e.stopPropagation()}>
                    {canEd ? <select value={it.status} onChange={e => handleStatusChange(it.id, e.target.value)} style={{ padding: "2px 4px", borderRadius: 8, border: "none", background: st?.bg || "#F3F4F6", color: st?.c || "#6B7280", fontSize: 10, fontWeight: 600, cursor: "pointer", outline: "none", appearance: "auto" }}>{stList.map(s => <option key={s.k} value={s.k}>{s.l}</option>)}</select>
                    : <Bd c={st?.c} bg={st?.bg}>{st?.l || it.status}</Bd>}
                  </td>
                  {tab === "SD" && <td style={{ padding: "6px 4px", fontFamily: "'JetBrains Mono'", fontSize: 9 }} onClick={() => setDetId(it.id)}>{fm(it.planDate)}</td>}
                  <td style={{ padding: "6px 4px", fontFamily: "'JetBrains Mono'", fontSize: 9 }} onClick={() => setDetId(it.id)}>{fm(it.actualDate)}</td>
                  {tab === "SD" && (() => { const sd = subDelay(it); return <td style={{ padding: "6px 4px" }} onClick={() => setDetId(it.id)}>{sd > 0 ? <Bd c="#EA580C" bg="#FFEDD5">+{sd}</Bd> : sd === 0 ? <span style={{ color: "#64748B" }}>0</span> : "—"}</td>; })()}
                  <td style={{ padding: "6px 4px", fontFamily: "'JetBrains Mono'", fontSize: 9 }} onClick={() => setDetId(it.id)}>{fm(ap)}</td>
                  <td style={{ padding: "6px 4px", fontFamily: "'JetBrains Mono'", fontSize: 9 }} onClick={() => setDetId(it.id)}>{fm(it.approveDate)}</td>
                  <td style={{ padding: "6px 4px" }} onClick={() => setDetId(it.id)}>{l > 0 ? <Bd c="#DC2626" bg="#FEE2E2">+{l}</Bd> : l === 0 ? <span style={{ color: "#64748B" }}>0</span> : "—"}</td>
                  {tab === "RFI" && <td style={{ padding: "6px 4px" }} onClick={() => setDetId(it.id)}>{rcItem ? <Bd c={rcItem.c} bg={rcItem.bg}>{rcItem.l}</Bd> : "—"}</td>}
                  <td style={{ padding: "6px 4px" }} onClick={() => setDetId(it.id)}>{lk.length > 0 && <span style={{ color: "#3B82F6" }}>🔗{lk.length}</span>}</td>
                  <td style={{ padding: "6px 4px" }} onClick={() => setDetId(it.id)}>{(it.notes || []).length > 0 && <span style={{ color: "#D97706" }}>📝{it.notes.length}</span>}</td>
                </tr>;
              })}</tbody>
          </table>
        </div>
      </div>}

      {view === "form" && eIt && <FormV item={eIt} onSave={sv} onCancel={() => { setEditId(null); setView("list"); }} canEd={canEd} />}
    </div>
  </>);
}

// ─── Detail Panel ───
function Detail({ item, items, canDel, canEd, onClose, onEdit, onLink, onUnlink, onNote, onDelNote, onDel, onGo }) {
  const [nt, setNt] = useState(""); const [ls, setLs] = useState(""); const [slp, setSlp] = useState(false);
  const [uploading, setUploading] = useState(false); const fileRef = useRef(null);
  const st = getStatusItem(item.type, item.status); const r = rsk(item); const rc = RC[r]; const l = ld(item); const sd = subDelay(item);
  const ap = apprPlan(item);
  const lk = (item.links || []).map(lid => items.find(x => x.id === lid)).filter(Boolean);
  const dpt = DEPTS.find(d => d.k === item.dept);
  const rcItem = ROOT_CAUSES.find(rc => rc.k === item.rootCause);
  const actSt = ACTION_STATUS.find(s => s.k === item.actionStatus);

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { alert("File quá lớn (>10MB)"); return; }
    setUploading(true);
    try {
      const f = await uploadFile(file, item.id);
      onNote(nt || `📎 Đính kèm: ${file.name}`, f);
      setNt("");
    } catch (err) { alert("Lỗi upload: " + err.message); }
    setUploading(false);
  };

  return (<>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
      <div>
        <div style={{ fontSize: 10, color: "#64748B" }}>{item.type}</div>
        <div style={{ fontSize: 18, fontWeight: 800, fontFamily: "'JetBrains Mono'" }}>{item.code || "—"}</div>
      </div>
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <span>{rc.i}</span><Bd c={rc.c} bg={rc.bg}>{rc.l}</Bd>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "#64748B", fontSize: 18, cursor: "pointer", marginLeft: 4 }}>✕</button>
      </div>
    </div>
    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{item.name || "Chưa đặt tên"}</div>
    {/* Info grid */}
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 14 }}>
      {[["Block", item.block], ["Tầng", item.floor], ["Bộ phận", item.dept ? <Bd c={dpt?.c} bg={dpt?.bg}>{item.dept}</Bd> : "—"], ["Hạng mục", item.cat], ["Người vẽ", item.who], ["Đệ trình", item.sub], ["Trạng thái", st ? <Bd c={st.c} bg={st.bg}>{st.l}</Bd> : item.status], ["Rev", item.rev],
        ...(item.type === "SD" ? [["KH nộp", fm(item.planDate)]] : []),
        ["TT nộp", fm(item.actualDate)],
        ...(item.type === "SD" ? [["Trễ trình", sd > 0 ? <Bd c="#EA580C" bg="#FFEDD5">+{sd}</Bd> : sd === 0 ? "0" : "—"]] : []),
        ["Offset", `+${item.offset} ngày`],
        [item.type === "RFI" ? "KH đóng" : "KH duyệt", fm(ap)],
        [item.type === "RFI" ? "TT đóng" : "TT duyệt", fm(item.approveDate)],
        ["Delay", l > 0 ? <Bd c="#DC2626" bg="#FEE2E2">+{l} ngày</Bd> : l === 0 ? "0" : "—"],
        ...(item.type === "RFI" ? [
          ["Nguyên nhân", rcItem ? <Bd c={rcItem.c} bg={rcItem.bg}>{rcItem.l}</Bd> : "—"],
          ["Người chịu TN", item.actionOwner || "—"],
          ["Trạng thái xử lý", actSt ? <Bd c={actSt.c} bg={actSt.bg}>{actSt.l}</Bd> : "—"],
          ["Deadline", fmFull(item.actionDeadline)],
        ] : []),
      ].map(([lbl, val], i) => <div key={i} style={{ padding: "6px 8px", background: "#0F172A", borderRadius: 6 }}><div style={{ fontSize: 9, color: "#64748B", marginBottom: 2 }}>{lbl}</div><div style={{ fontSize: 12, fontWeight: 600 }}>{val || "—"}</div></div>)}
    </div>
    {/* Links */}
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#64748B", marginBottom: 6 }}>🔗 Liên kết ({lk.length})</div>
      {lk.map(x => <div key={x.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", background: "#0F172A", borderRadius: 5, marginBottom: 3, cursor: "pointer" }} onClick={() => onGo(x.id)}>
        <span style={{ fontSize: 10 }}>{x.type === "SD" ? "📐" : "📝"}</span><span style={{ fontSize: 11, fontWeight: 600, fontFamily: "'JetBrains Mono'" }}>{x.code}</span><span style={{ fontSize: 10, color: "#64748B", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.name}</span>
        {canEd && <button onClick={e => { e.stopPropagation(); onUnlink(x.id); }} style={{ background: "none", border: "none", color: "#64748B", fontSize: 10, cursor: "pointer" }}>✕</button>}
      </div>)}
      {canEd && <>
        {slp ? <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
          <select value={ls} onChange={e => setLs(e.target.value)} style={{ flex: 1, padding: "4px 6px", borderRadius: 5, border: "1px solid #334155", background: "#0F172A", color: "#F1F5F9", fontSize: 11 }}>
            <option value="">Chọn...</option>{items.filter(x => x.id !== item.id && !(item.links || []).includes(x.id)).map(x => <option key={x.id} value={x.id}>{x.type} {x.code}: {x.name?.slice(0, 30)}</option>)}
          </select>
          <button onClick={() => { if (ls) { onLink(ls); setLs(""); } }} style={{ padding: "4px 8px", borderRadius: 5, border: "none", background: "#3B82F6", color: "#fff", fontSize: 10, cursor: "pointer" }}>+</button>
          <button onClick={() => setSlp(false)} style={{ padding: "4px 8px", borderRadius: 5, border: "1px solid #334155", background: "transparent", color: "#64748B", fontSize: 10, cursor: "pointer" }}>✕</button>
        </div> : <button onClick={() => setSlp(true)} style={{ marginTop: 4, padding: "3px 10px", borderRadius: 5, border: "1px solid #334155", background: "transparent", color: "#3B82F6", fontSize: 10, cursor: "pointer" }}>+ Thêm liên kết</button>}
      </>}
    </div>
    {/* Notes */}
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#64748B", marginBottom: 6 }}>📝 Ghi chú ({(item.notes || []).length})</div>
      {canEd && <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
        <input value={nt} onChange={e => setNt(e.target.value)} placeholder="Thêm ghi chú..." onKeyDown={e => { if (e.key === "Enter" && nt.trim()) { onNote(nt); setNt(""); } }} style={{ flex: 1, padding: "6px 8px", borderRadius: 5, border: "1px solid #334155", background: "#0F172A", color: "#F1F5F9", fontSize: 11 }} />
        <button onClick={() => fileRef.current?.click()} disabled={uploading} style={{ padding: "6px 8px", borderRadius: 5, border: "1px solid #334155", background: "transparent", color: "#64748B", fontSize: 11, cursor: "pointer" }}>{uploading ? "..." : "📎"}</button>
        <input ref={fileRef} type="file" onChange={handleFileUpload} style={{ display: "none" }} />
        <button onClick={() => { if (nt.trim()) { onNote(nt); setNt(""); } }} style={{ padding: "6px 10px", borderRadius: 5, border: "none", background: "#3B82F6", color: "#fff", fontSize: 11, cursor: "pointer" }}>+</button>
      </div>}
      {(item.notes || []).slice().reverse().map(n => (
        <div key={n.id} style={{ padding: "6px 8px", background: "#0F172A", borderRadius: 5, marginBottom: 3 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
            <span style={{ fontSize: 9, color: "#64748B" }}>{n.d} {n.h}</span>
            {canEd && <button onClick={() => onDelNote(n.id)} style={{ background: "none", border: "none", color: "#64748B", fontSize: 10, cursor: "pointer" }}>✕</button>}
          </div>
          <div style={{ fontSize: 11, lineHeight: 1.4 }}>{n.t}</div>
          {n.file && <a href={n.file.url} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 3, fontSize: 10, color: "#3B82F6", textDecoration: "none" }}>
            <span>{fileIcon(n.file.name)}</span><span style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.file.name}</span><span style={{ color: "#64748B" }}>({Math.round((n.file.size || 0) / 1024)}KB)</span>
          </a>}
        </div>))}
    </div>
    <div style={{ display: "flex", gap: 6 }}>
      {canEd && <button onClick={onEdit} style={{ flex: 1, padding: "7px 0", borderRadius: 7, border: "1px solid #334155", background: "transparent", color: "#3B82F6", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>✏️ Sửa</button>}
      {canDel && <button onClick={() => { if (window.confirm("Xóa?")) onDel(); }} style={{ padding: "7px 12px", borderRadius: 7, border: "1px solid #7F1D1D", background: "transparent", color: "#EF4444", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>🗑</button>}
    </div>
  </>);
}

// ─── Form ───
function FormV({ item, onSave, onCancel, canEd }) {
  const [f, setF] = useState({ ...item }); const u = (k, v) => setF(p => ({ ...p, [k]: v }));
  const isRFI = f.type === "RFI";
  const stList = getStatusList(f.type);
  const apprPlanDate = apprPlan(f);
  const r = rsk(f), rc = RC[r], l = ld(f);
  const sd = subDelay(f);
  const catOptions = DEPT_CATS[f.dept] || [];
  const I = { padding: "8px 10px", borderRadius: 7, border: "1px solid #334155", background: "#0F172A", color: "#F1F5F9", fontSize: 12, width: "100%" };
  const L = { fontSize: 10, fontWeight: 600, color: "#64748B", marginBottom: 2 };
  const onChangeType = (newType) => {
    setF(p => {
      const next = { ...p, type: newType };
      const validKeys = getStatusList(newType).map(s => s.k);
      if (!validKeys.includes(next.status)) {
        next.status = newType === "RFI" ? "OPEN" : "DANG_VE";
      }
      return next;
    });
  };

  if (!canEd) return <div style={{ padding: 40, textAlign: "center", color: "#64748B" }}>Bạn không có quyền chỉnh sửa</div>;

  return (<div style={{ maxWidth: 640, margin: "0 auto" }}><div style={{ background: "#1E293B", borderRadius: 10, padding: 18 }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
      <h2 style={{ fontSize: 16, fontWeight: 800 }}>{item.code ? "Sửa" : "Thêm"} {f.type}</h2>
      <div style={{ display: "flex", gap: 5 }}>
        <span>{rc.i}</span><Bd c={rc.c} bg={rc.bg}>{rc.l}</Bd>
        {sd > 0 && <Bd c="#EA580C" bg="#FFEDD5">Trễ trình {sd}d</Bd>}
        {l > 0 && <Bd c="#DC2626" bg="#FEE2E2">Delay {l}d</Bd>}
      </div>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
      <div><div style={L}>Loại</div><select value={f.type} onChange={e => onChangeType(e.target.value)} style={I}><option>SD</option><option>RFI</option></select></div>
      <div><div style={L}>Mã</div><input value={f.code} onChange={e => u("code", e.target.value)} style={I} placeholder={isRFI ? "RFI-001" : "SD-KC-001"} /></div>
      <div style={{ gridColumn: "1/-1" }}><div style={L}>Tên</div><input value={f.name} onChange={e => u("name", e.target.value)} style={I} placeholder="MB cốp pha sàn T5" /></div>
      <div><div style={L}>Block</div><input value={f.block} onChange={e => u("block", e.target.value)} style={I} /></div>
      <div><div style={L}>Tầng</div><input value={f.floor} onChange={e => u("floor", e.target.value)} style={I} /></div>
      <div><div style={L}>Bộ phận</div>
        <div style={{ display: "flex", gap: 4 }}>
          {DEPTS.map(d => <button key={d.k} onClick={() => { u("dept", d.k); if (!DEPT_CATS[d.k].includes(f.cat)) u("cat", DEPT_CATS[d.k][0] || ""); }} style={{ flex: 1, padding: "8px 0", borderRadius: 7, border: "2px solid", fontSize: 12, fontWeight: 700, cursor: "pointer", borderColor: f.dept === d.k ? d.c : "#334155", background: f.dept === d.k ? d.bg : "transparent", color: f.dept === d.k ? d.c : "#64748B" }}>{d.l}</button>)}
        </div>
      </div>
      <div><div style={L}>Hạng mục</div><select value={f.cat} onChange={e => u("cat", e.target.value)} style={I}>{catOptions.map(c => <option key={c}>{c}</option>)}<option value="">— Khác —</option></select>{!catOptions.includes(f.cat) && f.cat !== "" && <input value={f.cat} onChange={e => u("cat", e.target.value)} style={{ ...I, marginTop: 4 }} placeholder="Nhập hạng mục..." />}</div>
      <div><div style={L}>Rev</div><input type="number" min={0} value={f.rev} onChange={e => u("rev", +e.target.value || 0)} style={I} /></div>
      <div><div style={L}>Người vẽ</div><input value={f.who} onChange={e => u("who", e.target.value)} style={I} /></div>
      <div><div style={L}>Đệ trình</div><input value={f.sub} onChange={e => u("sub", e.target.value)} style={I} /></div>
      <div><div style={L}>Trạng thái</div><select value={f.status} onChange={e => u("status", e.target.value)} style={I}>{stList.map(s => <option key={s.k} value={s.k}>{s.l}</option>)}</select></div>
      {!isRFI && <div><div style={L}>KH nộp</div><input type="date" value={f.planDate || ""} onChange={e => u("planDate", e.target.value)} style={I} /></div>}
      <div><div style={L}>TT nộp</div><input type="date" value={f.actualDate || ""} onChange={e => u("actualDate", e.target.value)} style={I} /></div>
      <div><div style={L}>Offset {isRFI ? "đóng" : "duyệt"}</div><div style={{ display: "flex", gap: 3 }}>{[3, 5, 7, 10, 14].map(n => <button key={n} onClick={() => u("offset", n)} style={{ flex: 1, padding: "7px 0", borderRadius: 5, border: "1px solid", fontSize: 11, fontWeight: 700, cursor: "pointer", borderColor: f.offset === n ? "#3B82F6" : "#334155", background: f.offset === n ? "#3B82F6" : "transparent", color: f.offset === n ? "#fff" : "#64748B" }}>+{n}</button>)}</div></div>
      <div><div style={L}>{isRFI ? "KH đóng" : "KH duyệt"} <span style={{ color: "#64748B", fontWeight: 400 }}>(TT nộp + offset)</span></div><div style={{ ...I, background: "#1E293B", fontFamily: "'JetBrains Mono'" }}>{apprPlanDate ? fm(apprPlanDate) : "—"}</div></div>
      <div><div style={L}>{isRFI ? "TT đóng" : "TT duyệt"}</div><input type="date" value={f.approveDate || ""} onChange={e => u("approveDate", e.target.value)} style={I} /></div>
      {/* RFI extra fields */}
      {isRFI && <>
        <div><div style={L}>Nguyên nhân gốc</div><select value={f.rootCause || ""} onChange={e => u("rootCause", e.target.value)} style={I}><option value="">— Chọn —</option>{ROOT_CAUSES.map(rc => <option key={rc.k} value={rc.k}>{rc.l}</option>)}</select></div>
        <div><div style={L}>Người chịu trách nhiệm</div><input value={f.actionOwner || ""} onChange={e => u("actionOwner", e.target.value)} style={I} placeholder="TVTK / CĐT / Nhà thầu" /></div>
        <div><div style={L}>Trạng thái xử lý</div><select value={f.actionStatus || ""} onChange={e => u("actionStatus", e.target.value)} style={I}><option value="">— Chọn —</option>{ACTION_STATUS.map(s => <option key={s.k} value={s.k}>{s.l}</option>)}</select></div>
        <div><div style={L}>Deadline hành động</div><input type="date" value={f.actionDeadline || ""} onChange={e => u("actionDeadline", e.target.value)} style={I} /></div>
      </>}
    </div>
    <div style={{ display: "flex", gap: 8, marginTop: 14, justifyContent: "flex-end" }}>
      <button onClick={onCancel} style={{ padding: "8px 18px", borderRadius: 7, border: "1px solid #334155", background: "transparent", color: "#94A3B8", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Hủy</button>
      <button onClick={() => onSave(f)} style={{ padding: "8px 18px", borderRadius: 7, border: "none", background: "linear-gradient(135deg,#3B82F6,#8B5CF6)", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>💾 Lưu</button>
    </div>
  </div></div>);
}
