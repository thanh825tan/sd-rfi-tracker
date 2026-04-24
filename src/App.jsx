
import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { db, storage, ref, onValue, set, remove, update, storageRef, uploadBytes, getDownloadURL } from "./firebase";
/* eslint-disable no-unused-vars */
import { auth, googleProvider, signInWithPopup, signOut, onAuthStateChanged } from "./firebase";
/* eslint-enable no-unused-vars */

// ─── Constants ───
const ROLES = {
  owner: { l: "Chủ sở hữu", c: "#B08D57", bg: "#F5EBD9", level: 3 },
  editor: { l: "Biên tập", c: "#1E3A5F", bg: "#DBE5F1", level: 2 },
  viewer: { l: "Người xem", c: "#64748B", bg: "#E5E7EB", level: 1 },
};

const USERS_REF = "users";
const DEFAULT_USERS = {
  admin: { username: "admin", password: "admin123", role: "owner", displayName: "Admin" },
  a: { username: "a", password: "1", role: "viewer", displayName: "Người xem" },
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

// ─── ABCD Status mapping (cho xuất Excel/báo cáo theo form Asite/CĐT) ───
// A = Approved (không comment)
// B = Approved with comments
// C = Rejected with comments
// D = Pending Submission (chưa trình hoặc đang trong quá trình xử lý)
const ABCD_MAP = {
  DA_DUYET: "A",
  DUYET_GC: "B",
  REJECT: "C",
  DANG_VE: "D",
  CHO_REVIEW: "D",
  DA_NOP: "D",
  CHO_DUYET: "D",
  TAI_NOP: "D",
};
const ABCD_META = {
  A: { l: "Approved", c: "#059669", bg: "#D1FAE5" },
  B: { l: "Approved with comments", c: "#D97706", bg: "#FEF3C7" },
  C: { l: "Rejected with comments", c: "#DC2626", bg: "#FEE2E2" },
  D: { l: "Pending Submission", c: "#6B7280", bg: "#F3F4F6" },
};
const toABCD = (it) => {
  if (it.type !== "SD") return "D";
  return ABCD_MAP[it.status] || "D";
};

// ─── Project config (cấu hình prefix xuất Excel — có thể chỉnh ở Cài đặt dự án) ───
const PROJECT_CFG_REF = "projectConfig";
const DEFAULT_PROJECT_CFG = {
  projectCode: "MOBN",
  projectName: "MANDARIN ORIENTAL BAI NOM",
  contractorCode: "WCN",
  packageCode: "WP07",
  typeCode: "SDG",
  subject: "DOCUMENT CONTROL",
  defaultZone: "MUV2",
};

const ROOT_CAUSES = [
  { k: "CONFLICT", l: "Mâu thuẫn bộ môn", c: "#DC2626", bg: "#FEE2E2", desc: "AR vs ST vs MEP" },
  { k: "MISSING_INFO", l: "Thiếu thông tin TK", c: "#EA580C", bg: "#FFEDD5", desc: "Bản vẽ thiếu chi tiết" },
  { k: "DESIGN_ERROR", l: "Sai sót thiết kế", c: "#D97706", bg: "#FEF3C7", desc: "Lỗi trong bản vẽ" },
  { k: "OWNER_CHANGE", l: "CĐT thay đổi", c: "#7C3AED", bg: "#EDE9FE", desc: "Thay đổi yêu cầu" },
  { k: "MATERIAL", l: "Vật liệu/Kỹ thuật", c: "#2563EB", bg: "#DBEAFE", desc: "Đổi vật liệu, phương án" },
  { k: "COORDINATION", l: "Phối hợp thi công", c: "#0891B2", bg: "#CFFAFE", desc: "Vấn đề phối hợp" },
  { k: "OTHER", l: "Khác", c: "#6B7280", bg: "#F3F4F6", desc: "" },
];

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
  { k: "CIV", l: "CIV", c: "#B08D57", bg: "#F5EBD9" },
  { k: "MEP", l: "MEP", c: "#0891B2", bg: "#CFFAFE" },
];
const DEPT_CATS = {
  CIV: ["Kết cấu", "Kiến trúc", "Hoàn thiện", "Nội thất", "Cảnh quan", "Hạ tầng"],
  MEP: ["Điện", "Nước", "PCCC", "HVAC", "Thang máy", "Hệ thống BMS"],
};

// ─── Discipline (dùng cho group Excel export theo form CĐT) ───
// CIV (Wealthcons) được chia nhỏ ra ARC/STRUC/FIN cho báo cáo
const DISCIPLINES = [
  { k: "ARC", l: "ARC (Architecture)", c: "#B08D57", bg: "#F5EBD9", dept: "CIV" },
  { k: "STRUC", l: "STRUC (Structure)", c: "#7C3AED", bg: "#EDE9FE", dept: "CIV" },
  { k: "FIN", l: "FIN (Finishing)", c: "#EA580C", bg: "#FFEDD5", dept: "CIV" },
  { k: "INT", l: "INT (Interior)", c: "#DB2777", bg: "#FCE7F3", dept: "CIV" },
  { k: "LAN", l: "LAN (Landscape)", c: "#059669", bg: "#D1FAE5", dept: "CIV" },
  { k: "INF", l: "INF (Infrastructure)", c: "#6366F1", bg: "#EEF2FF", dept: "CIV" },
  { k: "ELE", l: "ELE (Electrical)", c: "#F59E0B", bg: "#FEF3C7", dept: "MEP" },
  { k: "PLU", l: "PLU (Plumbing)", c: "#06B6D4", bg: "#CFFAFE", dept: "MEP" },
  { k: "FIRE", l: "FIRE (Fire Fighting)", c: "#DC2626", bg: "#FEE2E2", dept: "MEP" },
  { k: "HVAC", l: "HVAC", c: "#0891B2", bg: "#CFFAFE", dept: "MEP" },
  { k: "ELV", l: "ELV (Lift/Elevator)", c: "#7C3AED", bg: "#EDE9FE", dept: "MEP" },
  { k: "BMS", l: "BMS (Building Management)", c: "#2563EB", bg: "#DBEAFE", dept: "MEP" },
];
const DISCIPLINE_MAP = {};
DISCIPLINES.forEach(d => { DISCIPLINE_MAP[d.k] = d; });

// Ánh xạ hạng mục cũ → discipline mới (để auto-gán discipline cho data cũ)
const CAT_TO_DISCIPLINE = {
  "Kiến trúc": "ARC", "Kết cấu": "STRUC", "Hoàn thiện": "FIN",
  "Nội thất": "INT", "Cảnh quan": "LAN", "Hạ tầng": "INF",
  "Điện": "ELE", "Nước": "PLU", "PCCC": "FIRE",
  "HVAC": "HVAC", "Thang máy": "ELV", "Hệ thống BMS": "BMS",
};
const getDiscipline = (it) => {
  if (it.discipline && DISCIPLINE_MAP[it.discipline]) return DISCIPLINE_MAP[it.discipline];
  const guessed = CAT_TO_DISCIPLINE[it.cat];
  if (guessed) return DISCIPLINE_MAP[guessed];
  // Fallback theo dept
  return DISCIPLINE_MAP[it.dept === "MEP" ? "ELE" : "ARC"];
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

// ─── Theme ───
const THEMES = {
  dark: {
    bg: "#0F172A", surface: "#1E293B", surface2: "#0F172A", border: "#334155",
    text: "#F1F5F9", textMuted: "#94A3B8", textDim: "#64748B",
    primary: "#B08D57", primaryLight: "#F5EBD9", primaryDark: "#8B6B3D",
    navy: "#1E3A5F", navyLight: "#DBE5F1",
    hover: "#1E293B", sidebar: "#1E293B", sidebarActive: "#B08D57",
  },
  light: {
    bg: "#F8FAFC", surface: "#FFFFFF", surface2: "#F1F5F9", border: "#E2E8F0",
    text: "#0F172A", textMuted: "#475569", textDim: "#94A3B8",
    primary: "#B08D57", primaryLight: "#F5EBD9", primaryDark: "#8B6B3D",
    navy: "#1E3A5F", navyLight: "#DBE5F1",
    hover: "#F1F5F9", sidebar: "#1E3A5F", sidebarActive: "#B08D57",
  },
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

// Week helpers
function getMondayOf(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d);
  monday.setDate(diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}
function getSundayOf(dateStr) {
  const m = getMondayOf(dateStr);
  if (!m) return null;
  const s = new Date(m);
  s.setDate(m.getDate() + 6);
  return s;
}
function getWeekKey(dateStr) {
  const m = getMondayOf(dateStr);
  return m ? isoFromDate(m) : null;
}
function getWeekLabel(weekKey) {
  if (!weekKey) return "";
  const d = new Date(weekKey);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}
function getWeekRange(mondayStr) {
  const m = new Date(mondayStr);
  const s = new Date(m); s.setDate(m.getDate() + 6);
  return `${m.getDate()}/${m.getMonth() + 1} → ${s.getDate()}/${s.getMonth() + 1}/${s.getFullYear()}`;
}
function isoFromDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function shiftWeek(mondayStr, n) {
  const d = new Date(mondayStr);
  d.setDate(d.getDate() + n * 7);
  return isoFromDate(d);
}
function getWeekNumber(mondayStr) {
  const d = new Date(mondayStr);
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const days = Math.floor((d - yearStart) / 864e5);
  return Math.ceil((days + yearStart.getDay() + 1) / 7);
}

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
    { id: "s6", type: "SD", code: "SD-KT-001", name: "MB tường xây T3 — Block A", block: "Block A", floor: "T3", dept: "CIV", cat: "Kiến trúc", who: "Lê Thị Mai", sub: "Trương Thanh Tân", status: "REJECT", planDate: d(-12), actualDate: d(-11), offset: 5, rev: 0, links: ["r2"], notes: [{ id: "n6", t: "Reject: sai kích thước cửa sổ", d: d(-5), h: "11:20" }] },
    { id: "s7", type: "SD", code: "SD-KT-002", name: "MB tường xây T3 — Block A (Rev1)", block: "Block A", floor: "T3", dept: "CIV", cat: "Kiến trúc", who: "Lê Thị Mai", sub: "Trương Thanh Tân", status: "TAI_NOP", planDate: d(-3), actualDate: d(-2), offset: 5, rev: 1, links: ["s6", "r2"], notes: [] },
    { id: "s8", type: "SD", code: "SD-KT-003", name: "Chi tiết ốp lát WC T4 — Block A", block: "Block A", floor: "T4", dept: "CIV", cat: "Hoàn thiện", who: "Lê Thị Mai", sub: "Trương Thanh Tân", status: "CHO_REVIEW", planDate: d(1), actualDate: "", offset: 5, rev: 0, links: [], notes: [] },
    { id: "s9", type: "SD", code: "SD-KC-006", name: "MB cốp pha sàn T3 — Block B", block: "Block B", floor: "T3", dept: "CIV", cat: "Kết cấu", who: "Phạm Quốc Bảo", sub: "Trương Thanh Tân", status: "DA_DUYET", planDate: d(-25), actualDate: d(-26), approveDate: d(-20), offset: 7, rev: 0, links: [], notes: [] },
    { id: "s10", type: "SD", code: "SD-KC-007", name: "Chi tiết thép vách T3 — Block B", block: "Block B", floor: "T3", dept: "CIV", cat: "Kết cấu", who: "Phạm Quốc Bảo", sub: "Trương Thanh Tân", status: "DA_NOP", planDate: d(-8), actualDate: d(-6), offset: 7, rev: 0, links: [], notes: [] },
    { id: "s11", type: "SD", code: "SD-KC-008", name: "MB cốp pha sàn T4 — Block B", block: "Block B", floor: "T4", dept: "CIV", cat: "Kết cấu", who: "Phạm Quốc Bảo", sub: "Trương Thanh Tân", status: "DANG_VE", planDate: d(-2), actualDate: "", offset: 7, rev: 0, links: [], notes: [{ id: "n10", t: "⚠️ Trễ 2 ngày — đang làm song song vách T3", d: d(0), h: "08:00" }] },
    { id: "s12", type: "SD", code: "SD-MEP-001", name: "MB PCCC T2 — Block B", block: "Block B", floor: "T2", dept: "MEP", cat: "PCCC", who: "Võ Hoàng Long", sub: "Trương Thanh Tân", status: "DA_DUYET", planDate: d(-18), actualDate: d(-20), approveDate: d(-14), offset: 5, rev: 0, links: [], notes: [] },
    { id: "s13", type: "SD", code: "SD-MEP-002", name: "MB điện T3 — Block B", block: "Block B", floor: "T3", dept: "MEP", cat: "Điện", who: "Võ Hoàng Long", sub: "Trương Thanh Tân", status: "CHO_DUYET", planDate: d(-7), actualDate: d(-6), offset: 5, rev: 0, links: ["r4"], notes: [] },
    { id: "s14", type: "SD", code: "SD-MEP-003", name: "MB cấp thoát nước T3 — Block B", block: "Block B", floor: "T3", dept: "MEP", cat: "Nước", who: "Võ Hoàng Long", sub: "Trương Thanh Tân", status: "DANG_VE", planDate: d(5), actualDate: "", offset: 5, rev: 0, links: [], notes: [] },
    { id: "r1", type: "RFI", code: "RFI-001", name: "Xác nhận cao độ sàn T5 Block A", block: "Block A", floor: "T5", dept: "CIV", cat: "Kết cấu", who: "Nguyễn Văn Hùng", sub: "Trương Thanh Tân", status: "CLOSED", actualDate: d(-22), approveDate: d(-20), offset: 3, rev: 0, rootCause: "MISSING_INFO", actionOwner: "TVTK", actionStatus: "DONE", links: ["s1"], notes: [] },
    { id: "r2", type: "RFI", code: "RFI-002", name: "Xác nhận kích thước cửa sổ T3", block: "Block A", floor: "T3", dept: "CIV", cat: "Kiến trúc", who: "Lê Thị Mai", sub: "Trương Thanh Tân", status: "CLOSED", actualDate: d(-10), approveDate: d(-5), offset: 3, rev: 0, rootCause: "DESIGN_ERROR", actionOwner: "TVTK", actionStatus: "DONE", links: ["s6", "s7"], notes: [] },
    { id: "r3", type: "RFI", code: "RFI-003", name: "Confirm vị trí lỗ thang máy T6", block: "Block A", floor: "T6", dept: "CIV", cat: "Kết cấu", who: "Trần Minh Đức", sub: "Trương Thanh Tân", status: "OPEN", actualDate: d(-5), offset: 3, rev: 0, rootCause: "COORDINATION", actionOwner: "TVTK", actionStatus: "WAIT_TVTK", actionDeadline: d(-2), links: ["s4"], notes: [] },
    { id: "r4", type: "RFI", code: "RFI-004", name: "Thay đổi vật liệu ống điện T3 Block B", block: "Block B", floor: "T3", dept: "MEP", cat: "Điện", who: "Võ Hoàng Long", sub: "Trương Thanh Tân", status: "OPEN", actualDate: d(-3), offset: 3, rev: 0, rootCause: "MATERIAL", actionOwner: "CĐT", actionStatus: "WAIT_CDT", actionDeadline: d(1), links: ["s13"], notes: [] },
  ];
}

// ─── Firebase helpers ───
const ITEMS_REF = "items";
const writeAllItems = (items) => {
  const obj = {}; items.forEach(i => obj[i.id] = i);
  set(ref(db, ITEMS_REF), obj);
};
const writeItem = (it) => set(ref(db, `${ITEMS_REF}/${it.id}`), it);
const updateItem = (id, patch) => update(ref(db, `${ITEMS_REF}/${id}`), patch);
const deleteItem = (id) => remove(ref(db, `${ITEMS_REF}/${id}`));

async function uploadFile(file, itemId) {
  const path = `attachments/${itemId}/${Date.now()}_${file.name}`;
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
      return `<tr><td style="font-weight:700;font-family:monospace">${it.code}</td><td>${it.name || "—"}</td><td>${it.block}</td><td>${it.floor}</td>
      <td><span style="padding:2px 6px;border-radius:10px;font-size:10px;font-weight:700;background:${dpt?.bg || "#F3F4F6"};color:${dpt?.c || "#6B7280"}">${it.dept || "—"}</span></td>
      <td>${it.cat}</td><td>${it.who}</td>
      <td><span style="padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;background:${st?.bg};color:${st?.c}">${st?.l}</span></td>
      <td style="font-family:monospace;font-size:12px">${fm(it.planDate)}</td><td style="font-family:monospace;font-size:12px">${fm(it.actualDate)}</td>
      <td>${sd > 0 ? `<span style="color:#EA580C;font-weight:700">+${sd}</span>` : sd === 0 ? "0" : "—"}</td>
      <td style="font-family:monospace;font-size:12px">${fm(apprPlan(it))}</td>
      <td style="font-family:monospace;font-size:12px">${fm(it.approveDate)}</td>
      <td>${l > 0 ? `<span style="color:#DC2626;font-weight:700">+${l}</span>` : l === 0 ? "0" : "—"}</td>
      <td>${rcLabel}</td></tr>`;
    }).join("")}</tbody></table>`;
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Báo cáo SHOPDRAWING STUDIO — ${today}</title><style>
    body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:1400px;margin:auto;padding:30px;color:#1E293B;background:#F8FAFC}
    h1{color:#1E3A5F;border-bottom:3px solid #B08D57;padding-bottom:10px;font-size:24px}
    h2{color:#1E3A5F;margin-top:30px;font-size:18px;border-left:4px solid #B08D57;padding-left:10px}
    .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:20px 0}
    .kpi{padding:14px;background:#fff;border-radius:10px;box-shadow:0 1px 3px rgba(0,0,0,.08);border-left:4px solid #B08D57}
    .kpi .v{font-size:26px;font-weight:800;color:#1E3A5F}
    .kpi .l{font-size:11px;color:#64748B;text-transform:uppercase;letter-spacing:0.5px}
    table{width:100%;border-collapse:collapse;margin-top:10px;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06)}
    th{background:#1E3A5F;color:#fff;padding:10px;text-align:left;font-size:12px;font-weight:600}
    td{padding:8px 10px;border-bottom:1px solid #E2E8F0;font-size:12px}
    tr:nth-child(even){background:#F8FAFC}
    .meta{color:#64748B;font-size:12px;margin-bottom:20px}
  </style></head><body>
    <h1>📐 SHOPDRAWING STUDIO — Báo cáo dự án</h1>
    <div class="meta">Cập nhật: ${fmFull(today)} · Wealthcons · Precision in Every Detail</div>
    <div class="kpis">
      <div class="kpi"><div class="l">Tổng hạng mục</div><div class="v">${stats.tot}</div></div>
      <div class="kpi"><div class="l">Hoàn thành</div><div class="v">${done} (${pct}%)</div></div>
      <div class="kpi"><div class="l">SD</div><div class="v">${sdItems.length}</div></div>
      <div class="kpi"><div class="l">RFI</div><div class="v">${rfiItems.length}</div></div>
    </div>
    <h2>⚠️ Trễ hạn (${lateItems.length})</h2>${makeTable(lateItems)}
    <h2>🟠 Nguy cơ cao (${highItems.length})</h2>${makeTable(highItems)}
    <h2>📋 Toàn bộ hạng mục</h2>${makeTable(items)}
  </body></html>`;
}

// ─── SHOP DRAWING REGISTER — xuất theo form chuẩn CĐT (Asite style) ───
// Group: Zone (roman numeral I, II...) → Discipline (II.1 STRUCTURE, II.2 FINISHING ARC...)
// Header: Project + Subject + Day + khối STATUS A/B/C/D với count + %
function buildFullCode(it, cfg) {
  // Ghép: [projectCode]-[contractorCode]-[packageCode]-[zone]-[typeCode]-[discipline]-[NNNN]
  // Ví dụ: MOBN-WCN-WP07-MUV2-SDG-ARC-0001
  const zone = it.zone || cfg.defaultZone || "MUV2";
  const disc = getDiscipline(it).k;
  // Lấy số STT từ mã hiện tại (SD-KC-001 → 001, hoặc fallback id hash)
  const m = (it.code || "").match(/(\d+)\s*$/);
  const stt = m ? m[1].padStart(4, "0") : String((it.code || "").length * 7 % 10000).padStart(4, "0");
  return `${cfg.projectCode}-${cfg.contractorCode}-${cfg.packageCode}-${zone}-${cfg.typeCode}-${disc}-${stt}`;
}

function generateShopDrawingRegisterHTML(items, cfg) {
  const sdItems = items.filter(i => i.type === "SD");
  const today = td();

  // Đếm theo A/B/C/D
  const abcdCount = { A: 0, B: 0, C: 0, D: 0 };
  sdItems.forEach(it => { abcdCount[toABCD(it)]++; });
  const total = sdItems.length || 1;
  const pct = k => ((abcdCount[k] / total) * 100).toFixed(2).replace(".", ",") + "%";

  // Group theo Zone → Discipline
  const groups = {};
  sdItems.forEach(it => {
    const zone = it.zone || cfg.defaultZone || "MUV2";
    const disc = getDiscipline(it).k;
    if (!groups[zone]) groups[zone] = {};
    if (!groups[zone][disc]) groups[zone][disc] = [];
    groups[zone][disc].push(it);
  });

  // Sắp xếp zone (zone đặc biệt "TEMPORARY" lên đầu, còn lại theo alphabet)
  const zoneKeys = Object.keys(groups).sort((a, b) => {
    if (a.includes("TEMP")) return -1;
    if (b.includes("TEMP")) return 1;
    return a.localeCompare(b);
  });

  // Roman numerals
  const roman = n => ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"][n] || String(n);

  // Render status cell với màu chuẩn (A=xanh, B=xanh nhạt, C=đỏ, D=xám)
  // Render từng row SD
  let rowsHTML = "";
  let globalIdx = 0;
  zoneKeys.forEach((zone, zi) => {
    const romanZone = roman(zi + 1);
    const zoneLabel = zone.includes("TEMP") ? "TEMPORARY WORK" : zone.replace("MUV", "MUV") + " - BEACH RESIDENCE";

    // Zone header row
    rowsHTML += `<tr class="zone-row"><td colspan="13" class="zone-cell"><b>${romanZone}</b>&nbsp;&nbsp;${zoneLabel.toUpperCase()}</td></tr>`;

    // Với TEMP, không có discipline sub-group — render thẳng
    if (zone.includes("TEMP")) {
      (groups[zone][Object.keys(groups[zone])[0]] || []).forEach(it => {
        globalIdx++;
        rowsHTML += renderSdRow(it, globalIdx, cfg);
      });
      return;
    }

    // Sắp xếp discipline theo thứ tự: STRUC, ARC, FIN, INT, LAN, INF, rồi MEP
    const discOrder = ["STRUC", "ARC", "FIN", "INT", "LAN", "INF", "ELE", "PLU", "FIRE", "HVAC", "ELV", "BMS"];
    const discKeys = Object.keys(groups[zone]).sort((a, b) => discOrder.indexOf(a) - discOrder.indexOf(b));

    discKeys.forEach((disc, di) => {
      const discLabel = disc === "STRUC" ? "STRUCTURE" : disc === "ARC" ? "FINISHING (ARC)" : disc === "FIN" ? "FINISHING" : disc === "INT" ? "INTERIOR" : disc === "LAN" ? "LANDSCAPE" : disc === "INF" ? "INFRASTRUCTURE" : disc === "ELE" ? "ELECTRICAL" : disc === "PLU" ? "PLUMBING" : disc === "FIRE" ? "FIRE FIGHTING" : disc;
      rowsHTML += `<tr class="disc-row"><td colspan="13" class="disc-cell"><b>${romanZone}.${di + 1}</b>&nbsp;&nbsp;${discLabel.toUpperCase()}</td></tr>`;

      let localIdx = 0;
      groups[zone][disc].forEach(it => {
        globalIdx++;
        localIdx++;
        rowsHTML += renderSdRow(it, localIdx, cfg);
      });
    });
  });

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>SHOP DRAWING REGISTER — ${cfg.projectName}</title><style>
    body{font-family:"Times New Roman",serif;padding:20px;background:#fff;color:#000;font-size:11px}
    .header-top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;gap:20px}
    .header-info{flex:1}
    .header-info .row{margin-bottom:3px;font-size:12px}
    .header-info b{display:inline-block;min-width:90px;color:#1E3A5F}
    .title{font-size:20px;font-weight:800;color:#1E3A5F;margin:10px 0;letter-spacing:1px}
    .status-block{border:1.5px solid #1E3A5F;padding:0;min-width:360px}
    .status-block table{border-collapse:collapse;width:100%}
    .status-block th{background:#FEF08A;color:#1E3A5F;padding:4px 8px;border:1px solid #1E3A5F;font-size:11px}
    .status-block td{padding:3px 8px;border:1px solid #1E3A5F;font-size:10px}
    .status-block .lbl{text-align:center;font-weight:800;width:30px}
    .status-block .name{text-align:left}
    .status-block .num{text-align:right;font-family:"Courier New",monospace}
    .status-block .pct{text-align:right;font-weight:700}
    .status-block .st-a{background:#D1FAE5}
    .status-block .st-b{background:#D1FAE5}
    .status-block .st-c{background:#FEE2E2}
    .status-block .st-d{background:#F3F4F6}
    .logo-block{display:flex;align-items:center;gap:12px;margin-bottom:10px}
    .logo-w{width:58px;height:58px;background:#1E3A5F;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:32px;border-radius:6px;font-family:Arial}
    .logo-text{font-size:20px;font-weight:800;color:#1E3A5F;letter-spacing:2px}
    table.main{border-collapse:collapse;width:100%;margin-top:10px}
    table.main th{background:#BFDBFE;color:#1E3A5F;border:1px solid #1E3A5F;padding:6px 4px;font-size:10px;font-weight:700;text-align:center;vertical-align:middle}
    table.main td{border:1px solid #94A3B8;padding:4px 5px;font-size:10px;vertical-align:middle}
    table.main .mocv{background:#DBE5F1;font-weight:800;font-size:11px}
    table.main .zone-cell{background:#FFF3D6;font-weight:800;font-size:12px;padding:6px 8px}
    table.main .disc-cell{background:#FFE8C2;font-weight:700;font-size:11px;padding:5px 8px;padding-left:20px}
    table.main td.code{font-family:"Courier New",monospace;font-size:9px;white-space:nowrap}
    table.main td.name{min-width:280px}
    table.main td.date{font-family:"Courier New",monospace;text-align:center;font-size:9px}
    table.main td.st{width:24px;text-align:center;font-weight:700;font-size:10px}
    table.main td.num{text-align:center;font-family:"Courier New",monospace}
    .footer{margin-top:20px;text-align:right;font-size:10px;color:#64748B}
    @media print{body{padding:10px}}
  </style></head><body>

    <div class="header-top">
      <div class="header-info">
        <div class="row"><b>Project:</b> ${cfg.projectName}</div>
        <div class="row"><b>Subject:</b> ${cfg.subject}</div>
        <div class="row"><b>Day:</b> ${fmFull(today)}</div>
        <div class="title">SHOP DRAWING REGISTER</div>
      </div>
      <div class="status-block">
        <table>
          <tr><th class="lbl">STATUS</th><th class="name">&nbsp;</th><th class="num">MOUNT</th><th class="pct">%</th></tr>
          <tr class="st-a"><td class="lbl">A</td><td class="name">Approved</td><td class="num">${abcdCount.A || "-"}</td><td class="pct">${pct("A")}</td></tr>
          <tr class="st-b"><td class="lbl">B</td><td class="name">Approved with comments</td><td class="num">${abcdCount.B || "-"}</td><td class="pct">${pct("B")}</td></tr>
          <tr class="st-c"><td class="lbl">C</td><td class="name">Rejected with comments</td><td class="num">${abcdCount.C || "-"}</td><td class="pct">${pct("C")}</td></tr>
          <tr class="st-d"><td class="lbl">D</td><td class="name">Pending Submission</td><td class="num">${abcdCount.D || "-"}</td><td class="pct">${pct("D")}</td></tr>
        </table>
      </div>
    </div>

    <div class="logo-block">
      <div class="logo-w">W</div>
      <div class="logo-text">WEALTHCONS</div>
    </div>

    <table class="main">
      <thead>
        <tr>
          <th rowspan="2" style="width:28px">STT</th>
          <th rowspan="2" style="width:180px">MÃ SHOPDRAWING<br/>(Drawing No.)</th>
          <th rowspan="2" style="width:300px">TÊN SHOPDRAWING<br/>(Drawing Title)</th>
          <th colspan="3">LẦN 1 (First Submission)</th>
          <th colspan="3">LẦN 2 (Resubmission)</th>
          <th colspan="3">LẦN 3 (2nd Resub)</th>
          <th rowspan="2" style="width:40px">REV</th>
        </tr>
        <tr>
          <th style="width:60px">Ngày nộp</th><th style="width:60px">Ngày duyệt</th><th style="width:24px">TT</th>
          <th style="width:60px">Ngày nộp</th><th style="width:60px">Ngày duyệt</th><th style="width:24px">TT</th>
          <th style="width:60px">Ngày nộp</th><th style="width:60px">Ngày duyệt</th><th style="width:24px">TT</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHTML}
      </tbody>
    </table>

    <div class="footer">Xuất từ SHOPDRAWING STUDIO · ${fmFull(today)} · Precision in Every Detail</div>
  </body></html>`;
}

function renderSdRow(it, idx, cfg) {
  const abcd = toABCD(it);
  const fullCode = buildFullCode(it, cfg);
  const colorMap = {
    A: "#86EFAC",  // xanh
    B: "#86EFAC",  // xanh
    C: "#FCA5A5",  // đỏ
    D: "#E5E7EB",  // xám
  };
  // Render 3 "lần" nộp: lần 1 từ data, lần 2 nếu có rev≥1, lần 3 để trống nếu chưa có
  const sub1 = fmFull(it.actualDate);
  const app1 = fmFull(it.approveDate);
  const st1 = it.actualDate ? abcd : "";
  // Revisions (rev=1 => có lần 2, rev=2 => có cả lần 3)
  const hasRev2 = (it.rev || 0) >= 1;
  const sub2 = hasRev2 ? fmFull(it.actualDate) : "—";
  const app2 = hasRev2 ? fmFull(it.approveDate) : "—";
  const st2 = hasRev2 ? abcd : "";
  const hasRev3 = (it.rev || 0) >= 2;
  const sub3 = hasRev3 ? "—" : "";
  const app3 = hasRev3 ? "—" : "";
  const st3 = hasRev3 ? abcd : "";

  const cell = (st) => st ? `<td class="st" style="background:${colorMap[st]}">${st}</td>` : `<td class="st"></td>`;

  return `<tr>
    <td style="text-align:center">${idx}</td>
    <td class="code">${fullCode}</td>
    <td class="name">${escHTML(it.name || "")}</td>
    <td class="date">${sub1}</td><td class="date">${app1}</td>${cell(st1)}
    <td class="date">${sub2}</td><td class="date">${app2}</td>${cell(st2)}
    <td class="date">${sub3}</td><td class="date">${app3}</td>${cell(st3)}
    <td class="num">${it.rev || 0}</td>
  </tr>`;
}

function escHTML(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ─── UI Helpers ───
const Bd = ({ c, bg, children, style }) => <span style={{ padding: "2px 8px", borderRadius: 10, fontSize: 10, fontWeight: 700, background: bg, color: c, display: "inline-block", ...style }}>{children}</span>;

// ─── Donut ───
function Donut({ data, size = 110 }) {
  const tot = data.reduce((s, d) => s + d.v, 0); if (!tot) return <div style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center", color: "#475569", fontSize: 11 }}>Trống</div>;
  const r = size / 2 - 8, C = 2 * Math.PI * r; let off = 0;
  return <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>{data.map((d, i) => { const p = d.v / tot, dash = C * p, start = -off; off += dash; return <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={d.c} strokeWidth={12} strokeDasharray={`${dash} ${C}`} strokeDashoffset={start} transform={`rotate(-90 ${size / 2} ${size / 2})`} />; })}<text x={size / 2} y={size / 2 - 5} textAnchor="middle" fill="var(--text)" fontSize={9} fontWeight={600}>TỔNG SỐ</text><text x={size / 2} y={size / 2 + 14} textAnchor="middle" fill="var(--text)" fontSize={20} fontWeight={800}>{tot}</text></svg>;
}

// ─── Bar ───
function Bar({ data, h = 110 }) {
  if (!data || !data.length) return <div style={{ height: h, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 11 }}>Trống</div>;
  const mx = Math.max(...data.map(d => d.v), 1);
  return <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: h, padding: "0 4px" }}>{data.map((d, i) => { const hh = (d.v / mx) * (h - 26); return <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 0 }}><div style={{ fontSize: 10, fontWeight: 700, fontFamily: "'JetBrains Mono'", color: "var(--text)" }}>{d.v}</div><div style={{ width: "100%", height: hh, background: d.c, borderRadius: "4px 4px 0 0", minHeight: 2 }} /><div style={{ fontSize: 9, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%", textAlign: "center" }}>{d.l}</div></div>; })}</div>;
}

// ─── Trend Chart ───
function TrendChart({ data, labels, h = 160 }) {
  if (!data || !data.length) return <div style={{ height: h, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 12 }}>Chưa có dữ liệu</div>;
  const maxV = Math.max(...data.flatMap(s => s.values), 1);
  const w = Math.max(data[0].values.length * 50, 200);
  const pad = { t: 20, b: 28, l: 30, r: 10 };
  const cw = w - pad.l - pad.r;
  const ch = h - pad.t - pad.b;
  const n = data[0].values.length;
  return <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet">
    {[0, 0.25, 0.5, 0.75, 1].map((f, i) => <g key={i}>
      <line x1={pad.l} y1={pad.t + ch * (1 - f)} x2={w - pad.r} y2={pad.t + ch * (1 - f)} stroke="var(--border)" strokeWidth={1} />
      <text x={pad.l - 4} y={pad.t + ch * (1 - f) + 3} textAnchor="end" fill="var(--text-dim)" fontSize={8}>{Math.round(maxV * f)}</text>
    </g>)}
    {data.map((series, si) => {
      const points = series.values.map((v, i) => {
        const x = pad.l + (i / (n - 1 || 1)) * cw;
        const y = pad.t + ch - (v / maxV) * ch;
        return `${x},${y}`;
      });
      return <g key={si}>
        <polyline points={points.join(" ")} fill="none" stroke={series.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {series.values.map((v, i) => {
          const x = pad.l + (i / (n - 1 || 1)) * cw;
          const y = pad.t + ch - (v / maxV) * ch;
          return <circle key={i} cx={x} cy={y} r={3} fill={series.color} />;
        })}
      </g>;
    })}
    {labels && labels.map((l, i) => <text key={i} x={pad.l + (i / (n - 1 || 1)) * cw} y={h - 4} textAnchor="middle" fill="var(--text-dim)" fontSize={8}>{l}</text>)}
  </svg>;
}

// ─── KPI Card ───
function KPICard({ label, value, target, unit = "", icon }) {
  const numVal = parseFloat(value) || 0;
  const numTarget = parseFloat(target) || 0;
  const isGood = unit === "%" ? numVal >= numTarget : unit === "ngày" ? numVal <= numTarget : numVal <= numTarget;
  const pct = numTarget ? Math.min(numVal / numTarget * 100, 150) : 0;
  return <div style={{ background: "var(--surface2)", borderRadius: 8, padding: "12px 14px", borderLeft: `3px solid ${isGood ? "#059669" : "#DC2626"}` }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
      <div>
        <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 2 }}>{icon} {label}</div>
        <div style={{ fontSize: 24, fontWeight: 800, color: isGood ? "#059669" : "#DC2626", fontFamily: "'JetBrains Mono'" }}>{value}{unit}</div>
      </div>
      <div style={{ padding: "2px 8px", borderRadius: 12, fontSize: 10, fontWeight: 600, background: isGood ? "#D1FAE5" : "#FEE2E2", color: isGood ? "#059669" : "#DC2626" }}>Target: {target}{unit}</div>
    </div>
    <div style={{ height: 4, borderRadius: 2, background: "var(--border)", overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${Math.min(pct, 100)}%`, background: isGood ? "#059669" : "#DC2626", borderRadius: 2 }} />
    </div>
  </div>;
}

// ─── Brand Logo ───
function BrandLogo({ size = 42, compact = false }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
    <svg width={size} height={size} viewBox="0 0 60 60">
      <rect x="4" y="4" width="52" height="52" fill="#1E3A5F" rx="3" />
      <g stroke="#B08D57" strokeWidth="1.8" fill="none">
        <line x1="10" y1="10" x2="50" y2="50" />
        <line x1="50" y1="10" x2="10" y2="50" />
        <rect x="14" y="14" width="32" height="32" />
        <line x1="22" y1="14" x2="22" y2="46" />
        <line x1="38" y1="14" x2="38" y2="46" />
        <line x1="14" y1="22" x2="46" y2="22" />
        <line x1="14" y1="38" x2="46" y2="38" />
      </g>
      <circle cx="30" cy="30" r="4" fill="#B08D57" />
    </svg>
    {!compact && <div>
      <div style={{ fontSize: 14, fontWeight: 800, color: "#1E3A5F", letterSpacing: 0.5, lineHeight: 1 }}>
        <span style={{ color: "#1E3A5F" }}>SHOPDRAWING</span> <span style={{ color: "#B08D57" }}>STUDIO</span>
      </div>
      <div style={{ fontSize: 9, color: "var(--text-muted)", letterSpacing: 2, marginTop: 2 }}>PRECISION IN EVERY DETAIL</div>
    </div>}
  </div>;
}

// ─── Import Modal ───
function ImportModal({ onImport, onClose }) {
  const [text, setText] = useState(""); const [preview, setPreview] = useState([]); const [error, setError] = useState(""); const fileRef = useRef(null);
  const handleFile = (e) => { const file = e.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = (ev) => { setText(ev.target.result); processText(ev.target.result); }; reader.readAsText(file); };
  const processText = (t) => { setError(""); if (!t.trim()) { setPreview([]); return; } try { const rows = parseCSV(t); if (!rows.length) { setError("Không tìm thấy dữ liệu."); return; } setPreview(rows.map((r, i) => mapRowToItem(r, i))); } catch (e) { setError("Lỗi parse: " + e.message); } };
  const handleTextChange = (val) => { setText(val); if (val.trim()) processText(val); else setPreview([]); };
  const I = { padding: "8px 10px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)", fontSize: 12, width: "100%" };
  return <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.6)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
    <div style={{ background: "var(--surface)", borderRadius: 12, padding: 20, width: "100%", maxWidth: 800, maxHeight: "90vh", overflowY: "auto", border: "1px solid var(--border)" }} onClick={e => e.stopPropagation()}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}><h2 style={{ fontSize: 16, fontWeight: 800, color: "var(--text)" }}>📥 Nhập dữ liệu từ Excel/CSV</h2><button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-dim)", fontSize: 18, cursor: "pointer" }}>✕</button></div>
      <div style={{ background: "var(--surface2)", borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6 }}>
        <div style={{ fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>Hướng dẫn:</div>
        <div>1. Mở file Excel → Ctrl+A → Ctrl+C → Paste vào ô bên dưới</div>
        <div>2. Hoặc xuất file CSV/TSV từ Excel rồi chọn file</div>
        <div style={{ marginTop: 6, fontWeight: 600, color: "#B08D57" }}>Các cột: Code/Mã, Tên, Block, Tầng, Bộ phận (CIV/MEP), Hạng mục, Người vẽ, Đệ trình, Trạng thái, KH nộp, TT nộp, TT duyệt, Offset, Nguyên nhân, Rev</div>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}><button onClick={() => fileRef.current?.click()} style={{ padding: "8px 14px", borderRadius: 7, border: "1px solid var(--border)", background: "transparent", color: "#1E3A5F", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>📁 Chọn file CSV/TSV</button><input ref={fileRef} type="file" accept=".csv,.tsv,.txt" onChange={handleFile} style={{ display: "none" }} /></div>
      <textarea value={text} onChange={e => handleTextChange(e.target.value)} placeholder="Paste dữ liệu từ Excel vào đây... (Ctrl+V)" style={{ ...I, height: 120, resize: "vertical", fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }} />
      {error && <div style={{ color: "#EF4444", fontSize: 12, marginTop: 8, padding: "6px 10px", background: "#FEE2E2", borderRadius: 6 }}>{error}</div>}
      {preview.length > 0 && <>
        <div style={{ marginTop: 12, fontSize: 12, fontWeight: 700, color: "#059669" }}>✅ Xem trước: {preview.length} dòng</div>
        <div style={{ overflowX: "auto", marginTop: 6, borderRadius: 8, border: "1px solid var(--border)", maxHeight: 260, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead><tr style={{ background: "var(--surface2)" }}>{["Loại", "Mã", "Tên", "Block", "BP", "TT"].map((h, i) => <th key={i} style={{ padding: "6px 8px", textAlign: "left", color: "var(--text-muted)", fontSize: 10 }}>{h}</th>)}</tr></thead>
            <tbody>{preview.slice(0, 10).map((it, i) => { const st = getStatusItem(it.type, it.status); return <tr key={i}><td style={{ padding: "5px 8px" }}>{it.type}</td><td style={{ padding: "5px 8px", fontFamily: "'JetBrains Mono'", fontSize: 10 }}>{it.code}</td><td style={{ padding: "5px 8px", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</td><td style={{ padding: "5px 8px" }}>{it.block}</td><td style={{ padding: "5px 8px" }}>{it.dept}</td><td style={{ padding: "5px 8px" }}><Bd c={st?.c} bg={st?.bg}>{st?.l || it.status}</Bd></td></tr>; })}</tbody>
          </table>
          {preview.length > 10 && <div style={{ padding: 8, textAlign: "center", color: "var(--text-dim)", fontSize: 11 }}>... và {preview.length - 10} dòng nữa</div>}
        </div>
        <button onClick={() => onImport(preview)} style={{ marginTop: 10, padding: "10px 24px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#1E3A5F,#B08D57)", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", width: "100%" }}>✅ Nhập {preview.length} bản ghi</button>
      </>}
    </div>
  </div>;
}

// ─── Export Menu ───
function ExportMenu({ items, stats, projectCfg, onClose }) {
  const downloadCSV = (type) => { const csv = itemsToCSV(items, type); const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `${type || "all"}_${td()}.csv`; a.click(); URL.revokeObjectURL(url); };
  const downloadBoth = () => { downloadCSV("SD"); setTimeout(() => downloadCSV("RFI"), 500); };
  const openGoogleSheet = () => { downloadCSV(null); setTimeout(() => window.open("https://sheets.new", "_blank"), 500); };
  const previewReport = () => { const html = generateReportHTML(items, stats); const w = window.open("", "_blank"); w.document.write(html); w.document.close(); };
  const downloadReport = () => { const html = generateReportHTML(items, stats); const blob = new Blob([html], { type: "text/html;charset=utf-8" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `report_${td()}.html`; a.click(); URL.revokeObjectURL(url); };
  const previewSdRegister = () => { const html = generateShopDrawingRegisterHTML(items, projectCfg); const w = window.open("", "_blank"); w.document.write(html); w.document.close(); };
  const downloadSdRegister = () => { const html = generateShopDrawingRegisterHTML(items, projectCfg); const blob = new Blob([html], { type: "text/html;charset=utf-8" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `SD_Register_${projectCfg.projectCode}_${td()}.html`; a.click(); URL.revokeObjectURL(url); };
  const downloadSdRegisterXls = () => { const html = generateShopDrawingRegisterHTML(items, projectCfg); const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `SD_Register_${projectCfg.projectCode}_${td()}.xls`; a.click(); URL.revokeObjectURL(url); };
  const btn = { padding: "10px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)", fontSize: 12, fontWeight: 600, cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 10 };
  return <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.6)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
    <div style={{ background: "var(--surface)", borderRadius: 12, padding: 20, width: "100%", maxWidth: 480, border: "1px solid var(--border)", maxHeight: "90vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}><h2 style={{ fontSize: 16, fontWeight: 800, color: "var(--text)" }}>📤 Xuất dữ liệu</h2><button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-dim)", fontSize: 18, cursor: "pointer" }}>✕</button></div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {/* SD REGISTER — form chuẩn CĐT */}
        <div style={{ padding: "8px 10px", background: "linear-gradient(135deg,rgba(30,58,95,0.08),rgba(176,141,87,0.08))", borderRadius: 6, fontSize: 10, color: "var(--text-muted)", borderLeft: "3px solid #1E3A5F", marginBottom: 2 }}>
          <div style={{ fontWeight: 700, color: "var(--text)", fontSize: 11, marginBottom: 2 }}>📋 SHOP DRAWING REGISTER (form CĐT)</div>
          Form báo cáo chuẩn: group Zone → Discipline, có khối STATUS A/B/C/D
        </div>
        <button onClick={previewSdRegister} style={{ ...btn, borderLeft: "3px solid #1E3A5F" }}><span style={{ fontSize: 18 }}>👁️</span><div><div style={{ fontWeight: 700 }}>Xem SD Register</div><div style={{ fontSize: 10, color: "var(--text-muted)" }}>Mở tab mới — có thể in/lưu PDF</div></div></button>
        <button onClick={downloadSdRegister} style={{ ...btn, borderLeft: "3px solid #1E3A5F" }}><span style={{ fontSize: 18 }}>📄</span><div><div style={{ fontWeight: 700 }}>Tải SD Register (.html)</div><div style={{ fontSize: 10, color: "var(--text-muted)" }}>Mở được bằng trình duyệt</div></div></button>
        <button onClick={downloadSdRegisterXls} style={{ ...btn, borderLeft: "3px solid #B08D57" }}><span style={{ fontSize: 18 }}>📊</span><div><div style={{ fontWeight: 700 }}>Tải SD Register (.xls)</div><div style={{ fontSize: 10, color: "var(--text-muted)" }}>Mở trực tiếp bằng Excel (giữ format màu)</div></div></button>
        <div style={{ height: 1, background: "var(--border)", margin: "6px 0" }} />
        {/* Báo cáo tổng hợp */}
        <button onClick={previewReport} style={{ ...btn, borderLeft: "3px solid #B08D57" }}><span style={{ fontSize: 18 }}>👁️</span><div><div style={{ fontWeight: 700 }}>Xem báo cáo tổng hợp</div><div style={{ fontSize: 10, color: "var(--text-muted)" }}>Gồm cả SD + RFI</div></div></button>
        <button onClick={downloadReport} style={btn}><span style={{ fontSize: 18 }}>📄</span><div><div style={{ fontWeight: 700 }}>Tải báo cáo tổng hợp</div><div style={{ fontSize: 10, color: "var(--text-muted)" }}>File .html</div></div></button>
        <div style={{ height: 1, background: "var(--border)", margin: "6px 0" }} />
        {/* CSV */}
        <button onClick={() => downloadCSV("SD")} style={btn}><span style={{ fontSize: 18 }}>📐</span><div><div style={{ fontWeight: 700 }}>Chỉ SD (CSV)</div><div style={{ fontSize: 10, color: "var(--text-muted)" }}>{items.filter(i => i.type === "SD").length} bản ghi</div></div></button>
        <button onClick={() => downloadCSV("RFI")} style={btn}><span style={{ fontSize: 18 }}>📝</span><div><div style={{ fontWeight: 700 }}>Chỉ RFI (CSV)</div><div style={{ fontSize: 10, color: "var(--text-muted)" }}>{items.filter(i => i.type === "RFI").length} bản ghi</div></div></button>
        <button onClick={downloadBoth} style={btn}><span style={{ fontSize: 18 }}>📊</span><div><div style={{ fontWeight: 700 }}>Cả SD + RFI (2 file CSV)</div></div></button>
        <button onClick={openGoogleSheet} style={{ ...btn, borderLeft: "3px solid #059669" }}><span style={{ fontSize: 18 }}>📗</span><div><div style={{ fontWeight: 700 }}>Mở Google Sheets</div><div style={{ fontSize: 10, color: "var(--text-muted)" }}>Tải CSV + mở sheets.new</div></div></button>
      </div>
    </div>
  </div>;
}

// ─── User Management ───
function UserManagement({ onClose }) {
  const [users, setUsers] = useState({});
  const [newUser, setNewUser] = useState({ username: "", password: "", role: "viewer", displayName: "" });
  const [error, setError] = useState("");

  useEffect(() => {
    const usersRef = ref(db, USERS_REF);
    return onValue(usersRef, (snap) => {
      const data = snap.val();
      if (!data) { set(ref(db, USERS_REF), DEFAULT_USERS); setUsers(DEFAULT_USERS); }
      else setUsers(data);
    });
  }, []);

  const addUser = () => {
    if (!newUser.username.trim() || !newUser.password.trim()) { setError("Tên đăng nhập và mật khẩu không được trống"); return; }
    if (users[newUser.username.trim().toLowerCase()]) { setError("Tên đăng nhập đã tồn tại"); return; }
    const key = newUser.username.trim().toLowerCase();
    set(ref(db, `${USERS_REF}/${key}`), { ...newUser, username: key });
    setNewUser({ username: "", password: "", role: "viewer", displayName: "" });
    setError("");
  };

  const deleteUser = (username) => { if (username === "admin") return; if (window.confirm(`Xóa user "${username}"?`)) remove(ref(db, `${USERS_REF}/${username}`)); };
  const changeRole = (username, newRole) => { if (username === "admin") return; update(ref(db, `${USERS_REF}/${username}`), { role: newRole }); };

  const I = { padding: "8px 10px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)", fontSize: 12 };
  return <div style={{ background: "var(--surface)", borderRadius: 12, padding: 20, border: "1px solid var(--border)" }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
      <h2 style={{ fontSize: 16, fontWeight: 800, color: "var(--text)" }}>👥 Quản lý người dùng</h2>
    </div>
    <div style={{ background: "var(--surface2)", borderRadius: 8, padding: 14, marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", marginBottom: 8 }}>Thêm người dùng mới</div>
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
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {Object.entries(users).map(([key, u]) => {
        const roleInfo = ROLES[u.role] || ROLES.viewer;
        return <div key={key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "var(--surface2)", borderRadius: 7 }}>
          <div style={{ width: 32, height: 32, borderRadius: "50%", background: roleInfo.bg, color: roleInfo.c, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800 }}>{(u.displayName || u.username || "?")[0].toUpperCase()}</div>
          <div style={{ flex: 1 }}><div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{u.displayName || u.username}</div><div style={{ fontSize: 10, color: "var(--text-dim)" }}>@{u.username}</div></div>
          <select value={u.role} onChange={e => changeRole(key, e.target.value)} disabled={key === "admin"} style={{ ...I, width: "auto", opacity: key === "admin" ? 0.5 : 1 }}>{Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v.l}</option>)}</select>
          <Bd c={roleInfo.c} bg={roleInfo.bg}>{roleInfo.l}</Bd>
          {key !== "admin" && <button onClick={() => deleteUser(key)} style={{ background: "none", border: "none", color: "#EF4444", cursor: "pointer", fontSize: 14 }}>🗑</button>}
        </div>;
      })}
    </div>
  </div>;
}

// ─── Login Screen ───
function LoginScreen({ onLogin, theme }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [mode, setMode] = useState("login");

  const handleLogin = () => {
    if (!username.trim() || !password.trim()) { setError("Vui lòng nhập đầy đủ thông tin"); return; }
    setLoading(true); setError("");
    const key = username.trim().toLowerCase();
    try {
      const usersRef = ref(db, USERS_REF);
      const unsub = onValue(usersRef, (snap) => {
        try {
          unsub();
          var users = snap.val();
          if (!users) { set(ref(db, USERS_REF), DEFAULT_USERS); users = DEFAULT_USERS; }
          var user = users[key];
          if (!user) { setError("Tên đăng nhập không tồn tại"); setLoading(false); return; }
          if (user.password !== password) { setError("Mật khẩu không đúng"); setLoading(false); return; }
          onLogin({ username: key, role: user.role, displayName: user.displayName || key });
        } catch (err) { setError("Lỗi: " + err.message); setLoading(false); }
      }, function(err) {
        var user = DEFAULT_USERS[key];
        if (user && user.password === password) onLogin({ username: key, role: user.role, displayName: user.displayName || key });
        else { setError("Không thể kết nối. Kiểm tra internet."); setLoading(false); }
      });
    } catch (err) { setError("Lỗi: " + err.message); setLoading(false); }
  };

  const handleRegister = () => {
    if (!username.trim() || !password.trim()) { setError("Vui lòng nhập đầy đủ thông tin"); return; }
    if (password.length < 3) { setError("Mật khẩu phải có ít nhất 3 ký tự"); return; }
    setLoading(true); setError("");
    const key = username.trim().toLowerCase();
    const usersRef = ref(db, USERS_REF);
    const unsub = onValue(usersRef, (snap) => {
      unsub();
      var users = snap.val() || DEFAULT_USERS;
      if (users[key]) { setError("Tên đăng nhập đã tồn tại"); setLoading(false); return; }
      const newUser = { username: key, password, role: "viewer", displayName: displayName.trim() || key };
      set(ref(db, `${USERS_REF}/${key}`), newUser);
      onLogin(newUser);
    });
  };

  const handleKeyDown = e => { if (e.key === "Enter") (mode === "login" ? handleLogin : handleRegister)(); };

  const IS = { padding: "10px 12px", borderRadius: 8, border: "1px solid #E2E8F0", background: "#F8FAFC", color: "#0F172A", fontSize: 14, width: "100%" };

  return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #1E3A5F 0%, #0F172A 100%)", padding: 20 }}>
    <div style={{ width: "100%", maxWidth: 420 }}>
      <div style={{ background: "#FFFFFF", borderRadius: 14, padding: 30, boxShadow: "0 20px 60px rgba(0,0,0,0.4)" }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
            <BrandLogo size={60} compact />
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: 1 }}>
            <span style={{ color: "#1E3A5F" }}>SHOPDRAWING </span><span style={{ color: "#B08D57" }}>STUDIO</span>
          </div>
          <div style={{ fontSize: 10, color: "#64748B", letterSpacing: 3, marginTop: 3 }}>PRECISION IN EVERY DETAIL</div>
          <div style={{ marginTop: 16, fontSize: 13, color: "#64748B" }}>{mode === "login" ? "Đăng nhập hệ thống" : "Đăng ký tài khoản"}</div>
        </div>
        <div style={{ display: "flex", gap: 4, marginBottom: 14, background: "#F1F5F9", borderRadius: 8, padding: 4 }}>
          <button onClick={() => { setMode("login"); setError(""); }} style={{ flex: 1, padding: "7px 0", borderRadius: 6, border: "none", background: mode === "login" ? "#1E3A5F" : "transparent", color: mode === "login" ? "#fff" : "#64748B", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Đăng nhập</button>
          <button onClick={() => { setMode("register"); setError(""); }} style={{ flex: 1, padding: "7px 0", borderRadius: 6, border: "none", background: mode === "register" ? "#B08D57" : "transparent", color: mode === "register" ? "#fff" : "#64748B", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Đăng ký</button>
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: "#64748B", marginBottom: 4 }}>Tên đăng nhập</div>
          <input value={username} onChange={e => setUsername(e.target.value)} onKeyDown={handleKeyDown} placeholder="admin" style={IS} />
        </div>
        {mode === "register" && <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: "#64748B", marginBottom: 4 }}>Tên hiển thị (tùy chọn)</div>
          <input value={displayName} onChange={e => setDisplayName(e.target.value)} onKeyDown={handleKeyDown} placeholder="Nguyễn Văn A" style={IS} />
        </div>}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: "#64748B", marginBottom: 4 }}>Mật khẩu</div>
          <div style={{ position: "relative" }}>
            <input type={showPw ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} onKeyDown={handleKeyDown} placeholder="Nhập mật khẩu" style={{ ...IS, paddingRight: 40 }} />
            <button onClick={() => setShowPw(!showPw)} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#64748B", fontSize: 16, cursor: "pointer", padding: 4 }}>{showPw ? "🙈" : "👁️"}</button>
          </div>
        </div>
        {error && <div style={{ color: "#DC2626", fontSize: 12, marginBottom: 10, padding: "6px 10px", background: "#FEE2E2", borderRadius: 6 }}>{error}</div>}
        <button onClick={mode === "login" ? handleLogin : handleRegister} disabled={loading} style={{ padding: "12px 0", borderRadius: 10, border: "none", background: mode === "login" ? "linear-gradient(135deg, #1E3A5F, #2C5282)" : "linear-gradient(135deg, #B08D57, #8B6B3D)", color: "#fff", fontSize: 15, fontWeight: 700, cursor: loading ? "wait" : "pointer", width: "100%", opacity: loading ? 0.7 : 1 }}>
          {loading ? "Đang xử lý..." : mode === "login" ? "🔐 Đăng nhập" : "📝 Đăng ký"}
        </button>
        {mode === "register" && <div style={{ marginTop: 10, fontSize: 10, color: "#94A3B8", lineHeight: 1.6 }}>Tài khoản mới sẽ có quyền "Người xem". Liên hệ quản trị để nâng quyền.</div>}
      </div>
    </div>
  </div>;
}

// ═══════════════════════════════════════════════════════════════
// ─── Main App ───
// ═══════════════════════════════════════════════════════════════
export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [items, setItems] = useState([]); const [ok, setOk] = useState(false);
  const [page, setPage] = useState("overview");
  const [editId, setEditId] = useState(null);
  const [detId, setDetId] = useState(null);
  const [listType, setListType] = useState("SD");
  const [fl, setFl] = useState({ st: "ALL", rk: "ALL", bl: "ALL", ct: "ALL", wh: "ALL", fl: "ALL", dp: "ALL", q: "" });
  const [dashFl, setDashFl] = useState({ bl: "ALL", fl: "ALL", ct: "ALL", dp: "ALL" });
  const [showImport, setShowImport] = useState(false); const [showExport, setShowExport] = useState(false);
  const [toast, setToast] = useState(null);
  const [sortCol, setSortCol] = useState(null); const [sortDir, setSortDir] = useState("asc");
  const [selected, setSelected] = useState(new Set());
  const [lastSelId, setLastSelId] = useState(null);
  const [theme, setTheme] = useState(() => localStorage.getItem("ss_theme") || "dark");
  const [projectCfg, setProjectCfg] = useState(DEFAULT_PROJECT_CFG);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [weekMonday, setWeekMonday] = useState(() => {
    const m = getMondayOf(td());
    return m ? isoFromDate(m) : td();
  });

  const showToast = (msg, type = "success") => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

  useEffect(() => { localStorage.setItem("ss_theme", theme); }, [theme]);

  const userRole = currentUser?.role || "viewer";
  const canDel = canDelete(userRole);
  const canEd = canEdit(userRole);
  const canImp = canImport(userRole);

  useEffect(() => {
    const saved = sessionStorage.getItem("sd_rfi_user");
    if (saved) { try { setCurrentUser(JSON.parse(saved)); } catch { } }
  }, []);

  const handleLogin = (user) => { setCurrentUser(user); sessionStorage.setItem("sd_rfi_user", JSON.stringify(user)); };
  const handleLogout = () => { setCurrentUser(null); sessionStorage.removeItem("sd_rfi_user"); setItems([]); setOk(false); };

  useEffect(() => {
    if (!currentUser) return;
    const itemsRef = ref(db, ITEMS_REF);
    const unsub = onValue(itemsRef, (snapshot) => {
      try {
        const data = snapshot.val();
        if (data) {
          const arr = Object.values(data).map(it => {
            const x = { ...it };
            if (x.type === "RFI") x.status = normRfiStatus(x.status);
            else if (["DA_DUYET", "DUYET_GC"].includes(x.status) && !x.approveDate) x.approveDate = x.actualDate || x.planDate || "";
            return x;
          });
          setItems(arr);
        } else {
          const s = samples(); writeAllItems(s); setItems(s);
        }
        setOk(true);
      } catch (err) { console.error("Data load error:", err); setOk(true); }
    }, (err) => { console.error("Firebase items error:", err); const s = samples(); setItems(s); setOk(true); });
    return () => unsub();
  }, [currentUser]);

  // Load project config
  useEffect(() => {
    if (!currentUser) return;
    const cfgRef = ref(db, PROJECT_CFG_REF);
    const unsub = onValue(cfgRef, (snap) => {
      const data = snap.val();
      if (data) setProjectCfg({ ...DEFAULT_PROJECT_CFG, ...data });
      else set(ref(db, PROJECT_CFG_REF), DEFAULT_PROJECT_CFG);
    }, (err) => console.error("Project config load error:", err));
    return () => unsub();
  }, [currentUser]);

  const isDup = useCallback((code, excludeId = null) => {
    if (!code) return false;
    const c = code.trim().toLowerCase();
    return items.some(x => x.id !== excludeId && (x.code || "").trim().toLowerCase() === c);
  }, [items]);

  const sv = useCallback((it) => {
    if (isDup(it.code, it.id)) { showToast(`Mã "${it.code}" đã tồn tại!`, "error"); return; }
    writeItem(it); setEditId(null);
  }, [isDup]);

  const dl = useCallback((id) => { items.forEach(x => { if ((x.links || []).includes(id)) updateItem(x.id, { links: (x.links || []).filter(l => l !== id) }); }); deleteItem(id); if (detId === id) setDetId(null); }, [items, detId]);

  const handleImport = useCallback((newItems) => {
    const seen = new Set(); const unique = [];
    for (const it of newItems) { const k = (it.code || "").trim().toLowerCase(); if (!it.code || seen.has(k)) continue; seen.add(k); unique.push(it); }
    const existingKeys = new Set(items.map(x => (x.code || "").trim().toLowerCase()));
    const toAdd = unique.filter(it => !existingKeys.has((it.code || "").trim().toLowerCase()));
    const skipped = newItems.length - toAdd.length;
    toAdd.forEach(it => writeItem(it));
    setShowImport(false);
    showToast(skipped > 0 ? `Đã nhập ${toAdd.length} · Bỏ qua ${skipped} trùng` : `Đã nhập ${toAdd.length} bản ghi!`, toAdd.length > 0 ? "success" : "error");
  }, [items]);

  const handleStatusChange = useCallback((id, newStatus) => { updateItem(id, { status: newStatus }); }, []);

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

  const dashFls = useMemo(() => { let b = items; if (dashFl.bl !== "ALL") b = b.filter(i => i.block === dashFl.bl); if (dashFl.dp !== "ALL") b = b.filter(i => i.dept === dashFl.dp); return [...new Set(b.map(i => i.floor).filter(Boolean))].sort(); }, [items, dashFl.bl, dashFl.dp]);
  const dashCts = useMemo(() => { let b = items; if (dashFl.bl !== "ALL") b = b.filter(i => i.block === dashFl.bl); if (dashFl.fl !== "ALL") b = b.filter(i => i.floor === dashFl.fl); if (dashFl.dp !== "ALL") b = b.filter(i => i.dept === dashFl.dp); return [...new Set(b.map(i => i.cat).filter(Boolean))].sort(); }, [items, dashFl.bl, dashFl.fl, dashFl.dp]);

  // Filtered list for current page type
  const pageListType = useMemo(() => {
    if (["sd_list", "sd_overview", "sd_pending", "sd_late_submit"].includes(page)) return "SD";
    if (["rfi_list", "rfi_overview", "rfi_overdue", "rfi_analysis"].includes(page)) return "RFI";
    return listType;
  }, [page, listType]);

  // SD chậm đệ trình = có planDate < today, chưa có actualDate, không done, không reject
  const isSdLateSubmit = (it) => {
    if (it.type !== "SD") return false;
    if (isDone(it)) return false;
    if (it.status === "REJECT") return false;
    if (it.actualDate) return false;
    if (!it.planDate) return false;
    return it.planDate < td();
  };

  const flt = useMemo(() => items.filter(it => {
    if (it.type !== pageListType) return false;
    if (page === "rfi_overdue" && rsk(it) !== "late") return false;
    if (page === "sd_pending" && (isDone(it) || it.status === "REJECT")) return false;
    if (page === "sd_late_submit" && !isSdLateSubmit(it)) return false;
    if (fl.st !== "ALL" && it.status !== fl.st) return false;
    if (fl.rk !== "ALL" && rsk(it) !== fl.rk) return false;
    if (fl.bl !== "ALL" && it.block !== fl.bl) return false;
    if (fl.ct !== "ALL" && it.cat !== fl.ct) return false;
    if (fl.fl !== "ALL" && it.floor !== fl.fl) return false;
    if (fl.dp !== "ALL" && it.dept !== fl.dp) return false;
    if (fl.wh !== "ALL" && it.who !== fl.wh && it.sub !== fl.wh) return false;
    if (fl.q) { const s = fl.q.toLowerCase(); return `${it.code} ${it.name} ${it.block} ${it.floor} ${it.cat} ${it.dept} ${it.who} ${it.sub}`.toLowerCase().includes(s); }
    return true;
  }), [items, pageListType, page, fl]);

  const SORT_KEYS_SD = { "Mã": "code", "Tên": "name", "Block": "block", "Tầng": "floor", "BP": "dept", "HM": "cat", "Người vẽ": "who", "Đệ trình": "sub", "TT": "status", "KH nộp": "planDate", "TT nộp": "actualDate", "Trễ trình": "_subDelay", "KH duyệt": "_apprPlan", "TT duyệt": "approveDate", "Delay": "_late" };
  const SORT_KEYS_RFI = { "Mã": "code", "Tên": "name", "Block": "block", "Tầng": "floor", "BP": "dept", "HM": "cat", "Người vẽ": "who", "Đệ trình": "sub", "TT": "status", "TT nộp": "actualDate", "KH đóng": "_apprPlan", "TT đóng": "approveDate", "Delay": "_late", "Nguyên nhân": "rootCause" };
  const SORT_KEYS = pageListType === "RFI" ? SORT_KEYS_RFI : SORT_KEYS_SD;
  const COL_LABELS = pageListType === "RFI"
    ? ["Mã", "Tên", "Block", "Tầng", "BP", "HM", "Người vẽ", "Đệ trình", "TT", "TT nộp", "KH đóng", "TT đóng", "Delay", "Nguyên nhân"]
    : ["Mã", "Tên", "Block", "Tầng", "BP", "HM", "Người vẽ", "Đệ trình", "TT", "KH nộp", "TT nộp", "Trễ trình", "KH duyệt", "TT duyệt", "Delay"];
  const toggleSort = (colLabel) => { const key = SORT_KEYS[colLabel]; if (!key) return; if (sortCol === key) setSortDir(d => d === "asc" ? "desc" : "asc"); else { setSortCol(key); setSortDir("asc"); } };

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
      const ids = sorted.map(i => i.id); const a = ids.indexOf(lastSelId); const b = ids.indexOf(id);
      if (a !== -1 && b !== -1) { const [lo, hi] = a < b ? [a, b] : [b, a]; const range = ids.slice(lo, hi + 1);
        setSelected(prev => { const n = new Set(prev); range.forEach(rid => n.add(rid)); return n; }); setLastSelId(id); return;
      }
    }
    setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; }); setLastSelId(id);
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
    const bR = { late: 0, high: 0, med: 0, ok: 0, done: 0, reject: 0, none: 0 };
    items.forEach(it => { bR[rsk(it)]++; });
    return { bR, tot: items.length, sd: items.filter(i => i.type === "SD").length, rfi: items.filter(i => i.type === "RFI").length };
  }, [items]);

  const sdItemsDash = useMemo(() => dashItems.filter(i => i.type === "SD"), [dashItems]);
  const rfiItemsDash = useMemo(() => dashItems.filter(i => i.type === "RFI"), [dashItems]);

  const trendData = useMemo(() => {
    const rfiItems = dashItems.filter(i => i.type === "RFI");
    const weekMap = {};
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
        { color: "#1E3A5F", label: "RFI mở mới", values: weeks.map(w => weekMap[w]?.opened || 0) },
        { color: "#B08D57", label: "RFI đã đóng", values: weeks.map(w => weekMap[w]?.closed || 0) },
      ],
    };
  }, [dashItems]);

  const rootCauseData = useMemo(() => {
    const rfiItems = dashItems.filter(i => i.type === "RFI" && i.rootCause);
    const counts = {};
    rfiItems.forEach(it => { counts[it.rootCause] = (counts[it.rootCause] || 0) + 1; });
    return ROOT_CAUSES.filter(rc => counts[rc.k]).map(rc => ({ ...rc, count: counts[rc.k] || 0 })).sort((a, b) => b.count - a.count);
  }, [dashItems]);

  const responseTimeAnalysis = useMemo(() => {
    const rfiItems = dashItems.filter(i => i.type === "RFI");
    const closedRFIs = rfiItems.filter(i => normRfiStatus(i.status) === "CLOSED" && i.actualDate && i.approveDate);
    if (!closedRFIs.length) return { avgResponseTime: 0, byOwner: {} };
    const totalDays = closedRFIs.reduce((s, i) => s + Math.abs(dd(i.approveDate, i.actualDate) || 0), 0);
    const avgResponseTime = Math.round(totalDays / closedRFIs.length * 10) / 10;
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
      rfiOnTimePct, avgResponseTime: responseTimeAnalysis.avgResponseTime, sdFirstPassPct, lateOnCritical,
      completionPct: stats.tot ? Math.round(dashItems.filter(i => isDone(i)).length / stats.tot * 100) : 0,
    };
  }, [dashItems, stats, responseTimeAnalysis]);

  // ═══ Kế hoạch tuần ═══
  const weekPlan = useMemo(() => {
    const mondayDate = new Date(weekMonday); mondayDate.setHours(0, 0, 0, 0);
    const sundayDate = new Date(mondayDate); sundayDate.setDate(mondayDate.getDate() + 6); sundayDate.setHours(23, 59, 59, 999);
    const monIso = isoFromDate(mondayDate);
    const sunIso = isoFromDate(sundayDate);
    const todayIso = td();
    // A. Task chậm KH nhưng chưa triển khai (planDate < today, actualDate rỗng, không done, không reject)
    const overdueUnstarted = items.filter(it => {
      if (isDone(it)) return false;
      if (it.status === "REJECT") return false;
      if (it.actualDate) return false;
      if (!it.planDate) return false;
      return it.planDate < todayIso;
    }).sort((a, b) => (a.planDate || "").localeCompare(b.planDate || ""));
    // B. Task thuộc tuần (planDate trong khoảng tuần)
    const weekTasks = items.filter(it => {
      if (!it.planDate) return false;
      return it.planDate >= monIso && it.planDate <= sunIso;
    }).sort((a, b) => (a.planDate || "").localeCompare(b.planDate || ""));
    // C. Phân bố theo ngày trong tuần
    const byDay = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date(mondayDate); d.setDate(mondayDate.getDate() + i);
      byDay[isoFromDate(d)] = [];
    }
    weekTasks.forEach(it => { if (byDay[it.planDate]) byDay[it.planDate].push(it); });
    return { overdueUnstarted, weekTasks, byDay, monIso, sunIso };
  }, [items, weekMonday]);

  const alerts = useMemo(() => dashItems.filter(i => ["late", "high"].includes(rsk(i))).sort((a, b) => (rsk(a) === "late" ? 0 : 1) - (rsk(b) === "late" ? 0 : 1) || (a.planDate || "").localeCompare(b.planDate || "")), [dashItems]);

  const actionItems = useMemo(() => {
    return dashItems
      .filter(i => i.type === "RFI" && normRfiStatus(i.status) === "OPEN")
      .map(it => ({ ...it, actionStatus: it.actionStatus || "IN_PROGRESS", actionOwner: it.actionOwner || "Chưa phân", actionDeadline: it.actionDeadline || "", isOverdue: it.actionDeadline ? dd(td(), it.actionDeadline) > 0 : false }))
      .sort((a, b) => { if (a.isOverdue && !b.isOverdue) return -1; if (!a.isOverdue && b.isOverdue) return 1; return (a.actionDeadline || "").localeCompare(b.actionDeadline || ""); });
  }, [dashItems]);

  const det = detId ? items.find(x => x.id === detId) : null;
  const eIt = editId === "ns" ? { id: Date.now().toString(36), type: "SD", code: "", name: "", block: "", floor: "", dept: "CIV", cat: "", who: "", sub: "", status: "DANG_VE", planDate: "", actualDate: "", approveDate: "", offset: 7, rev: 0, links: [], notes: [], rootCause: "", actionStatus: "", actionOwner: "", actionDeadline: "" } : editId === "nr" ? { id: Date.now().toString(36), type: "RFI", code: "", name: "", block: "", floor: "", dept: "CIV", cat: "", who: "", sub: "", status: "OPEN", planDate: "", actualDate: "", approveDate: "", offset: 3, rev: 0, links: [], notes: [], rootCause: "", actionStatus: "", actionOwner: "", actionDeadline: "" } : items.find(x => x.id === editId);

  // ═══ Auth check ═══
  if (!currentUser) return <>
    <style>{themeCSS(theme)}</style>
    <LoginScreen onLogin={handleLogin} theme={theme} />
  </>;
  if (!ok) return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: THEMES[theme].bg, color: THEMES[theme].text }}>Đang đồng bộ dữ liệu...</div>;

  const done = dashItems.filter(i => isDone(i)).length;
  const pct = stats.tot ? Math.round(done / stats.tot * 100) : 0;
  const sdApproved = sdItemsDash.filter(i => isDone(i)).length;
  const sdPending = sdItemsDash.filter(i => !isDone(i) && i.status !== "REJECT").length;
  const sdOverdue = sdItemsDash.filter(i => rsk(i) === "late").length;
  const sdLateSubmit = items.filter(i => isSdLateSubmit(i)).length;
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

  const ss = { padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12 };
  const hasDashFilter = dashFl.bl !== "ALL" || dashFl.fl !== "ALL" || dashFl.ct !== "ALL" || dashFl.dp !== "ALL";
  const roleInfo = ROLES[userRole] || ROLES.viewer;

  // ═══ SIDEBAR MENU ═══
  const MENU = [
    { g: null, items: [{ k: "overview", l: "Tổng quan", i: "🏠" }] },
    { g: "SHOPDRAWING", items: [
      { k: "sd_overview", l: "Tổng quan SD", i: "📊" },
      { k: "sd_list", l: "Danh sách SD", i: "📋" },
      { k: "sd_pending", l: "SD chưa phê duyệt", i: "⏳" },
      { k: "sd_late_submit", l: "SD chậm đệ trình", i: "⚠️", badge: sdLateSubmit },
    ]},
    { g: "RFI", items: [
      { k: "rfi_overview", l: "Tổng quan RFI", i: "📊" },
      { k: "rfi_list", l: "Danh sách RFI", i: "📋" },
      { k: "rfi_overdue", l: "RFI quá hạn", i: "⚠️", badge: rfiOverdue },
      { k: "rfi_analysis", l: "Phân tích RFI", i: "🔍" },
    ]},
    { g: "BÁO CÁO", items: [
      { k: "report_summary", l: "Báo cáo tổng hợp", i: "📑" },
      { k: "report_export", l: "Xuất dữ liệu", i: "📤" },
    ]},
    { g: null, items: [{ k: "week_plan", l: "Kế hoạch tuần", i: "📅" }] },
    // Cài đặt chỉ hiện với owner
    ...(userRole === "owner" ? [{ g: "CÀI ĐẶT", items: [
      { k: "settings_project", l: "Dự án", i: "🏗️" },
      { k: "settings_users", l: "Người dùng", i: "👤" },
      { k: "settings_roles", l: "Vai trò & phân quyền", i: "🔐" },
    ]}] : []),
  ];

  return <>
    <style>{themeCSS(theme)}</style>
    {toast && <div style={{ position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 3000, padding: "10px 20px", borderRadius: 8, background: toast.type === "success" ? "#059669" : "#DC2626", color: "#fff", fontSize: 13, fontWeight: 600, boxShadow: "0 4px 20px rgba(0,0,0,.4)" }}>{toast.msg}</div>}

    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)", display: "flex" }}>
      {/* ═══ SIDEBAR ═══ */}
      <aside style={{ width: sidebarOpen ? 230 : 58, background: "var(--sidebar)", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", transition: "width 0.2s", position: "sticky", top: 0, height: "100vh", flexShrink: 0 }}>
        {/* Logo */}
        <div style={{ padding: sidebarOpen ? "14px 14px" : "14px 10px", borderBottom: "1px solid rgba(255,255,255,0.08)", background: "#1E3A5F" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: sidebarOpen ? "flex-start" : "center" }}>
            <svg width={36} height={36} viewBox="0 0 60 60" style={{ flexShrink: 0 }}>
              <rect x="4" y="4" width="52" height="52" fill="#1E3A5F" stroke="#B08D57" strokeWidth="1.5" rx="3" />
              <g stroke="#B08D57" strokeWidth="1.5" fill="none">
                <line x1="10" y1="10" x2="50" y2="50" />
                <line x1="50" y1="10" x2="10" y2="50" />
                <rect x="14" y="14" width="32" height="32" />
                <line x1="22" y1="14" x2="22" y2="46" />
                <line x1="38" y1="14" x2="38" y2="46" />
                <line x1="14" y1="22" x2="46" y2="22" />
                <line x1="14" y1="38" x2="46" y2="38" />
              </g>
              <circle cx="30" cy="30" r="3" fill="#B08D57" />
            </svg>
            {sidebarOpen && <div>
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.3, lineHeight: 1.1 }}>
                <span style={{ color: "#fff" }}>SHOPDRAWING</span><br /><span style={{ color: "#B08D57" }}>STUDIO</span>
              </div>
              <div style={{ fontSize: 7, color: "rgba(255,255,255,0.5)", letterSpacing: 1.5, marginTop: 2 }}>PRECISION IN EVERY DETAIL</div>
            </div>}
          </div>
        </div>

        {/* Menu */}
        <nav style={{ flex: 1, overflowY: "auto", padding: "10px 0" }}>
          {MENU.map((group, gi) => <div key={gi} style={{ marginBottom: 8 }}>
            {group.g && sidebarOpen && <div style={{ padding: "8px 16px 4px", fontSize: 9, fontWeight: 800, color: "rgba(255,255,255,0.4)", letterSpacing: 1.2 }}>{group.g}</div>}
            {group.items.map(m => {
              const active = page === m.k;
              return <button key={m.k} onClick={() => { setPage(m.k); setEditId(null); setDetId(null); setFl({ st: "ALL", rk: "ALL", bl: "ALL", ct: "ALL", wh: "ALL", fl: "ALL", dp: "ALL", q: "" }); setSelected(new Set()); }}
                style={{
                  width: "100%", padding: sidebarOpen ? "9px 16px" : "10px", display: "flex", alignItems: "center", gap: 10,
                  background: active ? "#B08D57" : "transparent",
                  color: active ? "#fff" : "rgba(255,255,255,0.8)",
                  border: "none", cursor: "pointer", fontSize: 12, fontWeight: active ? 700 : 500,
                  borderLeft: active ? "3px solid #fff" : "3px solid transparent",
                  justifyContent: sidebarOpen ? "flex-start" : "center",
                  transition: "background 0.15s",
                  textAlign: "left"
                }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}>
                <span style={{ fontSize: 15 }}>{m.i}</span>
                {sidebarOpen && <span style={{ flex: 1 }}>{m.l}</span>}
                {sidebarOpen && m.badge > 0 && <span style={{ background: "#DC2626", color: "#fff", fontSize: 9, fontWeight: 800, padding: "1px 6px", borderRadius: 10, minWidth: 18, textAlign: "center" }}>{m.badge}</span>}
              </button>;
            })}
          </div>)}
        </nav>

        {/* User info */}
        <div style={{ padding: sidebarOpen ? 12 : 8, borderTop: "1px solid rgba(255,255,255,0.08)", background: "rgba(0,0,0,0.2)" }}>
          {sidebarOpen ? <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: "50%", background: roleInfo.bg, color: roleInfo.c, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, flexShrink: 0 }}>
              {(currentUser.displayName || currentUser.username)[0].toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{currentUser.displayName || currentUser.username}</div>
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.5)" }}>{roleInfo.l}</div>
            </div>
            <button onClick={handleLogout} title="Đăng xuất" style={{ background: "none", border: "none", color: "#F87171", fontSize: 14, cursor: "pointer", padding: 4 }}>⎋</button>
          </div> : <div style={{ textAlign: "center" }}>
            <div style={{ width: 32, height: 32, borderRadius: "50%", background: roleInfo.bg, color: roleInfo.c, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, margin: "0 auto" }}>
              {(currentUser.displayName || currentUser.username)[0].toUpperCase()}
            </div>
          </div>}
        </div>
      </aside>

      {/* ═══ MAIN ═══ */}
      <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        {/* Top bar */}
        <header style={{ padding: "10px 18px", borderBottom: "1px solid var(--border)", background: "var(--surface)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button onClick={() => setSidebarOpen(o => !o)} style={{ background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 14, padding: "5px 9px", borderRadius: 6, cursor: "pointer" }}>☰</button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text)", letterSpacing: -0.2 }}>{getPageTitle(page)}</div>
            <div style={{ fontSize: 10, color: "var(--text-dim)" }}>Wealthcons · {fullStats.sd} SD · {fullStats.rfi} RFI · Cập nhật {fmFull(td())}</div>
          </div>
          {canEd && <button onClick={() => { setEditId("ns"); setPage("sd_list"); }} style={{ padding: "6px 12px", borderRadius: 6, border: "none", background: "linear-gradient(135deg,#1E3A5F,#2C5282)", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>+ SD</button>}
          {canEd && <button onClick={() => { setEditId("nr"); setPage("rfi_list"); }} style={{ padding: "6px 12px", borderRadius: 6, border: "none", background: "linear-gradient(135deg,#B08D57,#8B6B3D)", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>+ RFI</button>}
          {canImp && <button onClick={() => setShowImport(true)} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "#059669", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>📥</button>}
          <button onClick={() => setShowExport(true)} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "#0891B2", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>📤</button>
          <button onClick={() => setTheme(t => t === "dark" ? "light" : "dark")} title="Đổi theme" style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--text)", fontSize: 12, cursor: "pointer" }}>{theme === "dark" ? "☀️" : "🌙"}</button>
        </header>

        {/* Modals */}
        {showImport && <ImportModal onImport={handleImport} onClose={() => setShowImport(false)} />}
        {showExport && <ExportMenu items={items} stats={fullStats} projectCfg={projectCfg} onClose={() => setShowExport(false)} />}

        {/* Content */}
        <div style={{ flex: 1, padding: 16, overflowY: "auto", position: "relative" }}>

          {/* Detail side panel */}
          {det && <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 460, background: "var(--surface)", borderLeft: "1px solid var(--border)", padding: 18, overflowY: "auto", zIndex: 1500, boxShadow: "-8px 0 24px rgba(0,0,0,0.2)" }}>
            <Detail item={det} items={items}
              canDel={canDel} canEd={canEd}
              onClose={() => setDetId(null)}
              onEdit={() => { setEditId(det.id); setDetId(null); }}
              onLink={lid => updateItem(det.id, { links: [...(det.links || []), lid] })}
              onUnlink={lid => updateItem(det.id, { links: (det.links || []).filter(l => l !== lid) })}
              onNote={(t, f) => {
                const n = { id: Date.now().toString(36), t, d: td(), h: new Date().toTimeString().slice(0, 5) };
                if (f) n.file = f;
                updateItem(det.id, { notes: [...(det.notes || []), n] });
              }}
              onDelNote={nid => updateItem(det.id, { notes: (det.notes || []).filter(n => n.id !== nid) })}
              onDel={() => dl(det.id)}
              onGo={id => setDetId(id)} />
          </div>}

          {/* Edit form */}
          {eIt && <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.6)", zIndex: 1600, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => setEditId(null)}>
            <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 680, maxHeight: "92vh", overflowY: "auto" }}>
              <FormV item={eIt} onSave={sv} onCancel={() => setEditId(null)} canEd={canEd} />
            </div>
          </div>}

          {/* ═══ OVERVIEW PAGE ═══ */}
          {page === "overview" && <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Dashboard filters */}
            <div style={{ background: "var(--surface)", borderRadius: 10, padding: "10px 12px", border: "1px solid var(--border)", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>🔎 Lọc:</span>
              <select value={dashFl.dp} onChange={e => setDashFl(f => ({ ...f, dp: e.target.value }))} style={ss}><option value="ALL">Tất cả BP</option>{DEPTS.map(d => <option key={d.k} value={d.k}>{d.l}</option>)}</select>
              <select value={dashFl.bl} onChange={e => setDashFl(f => ({ ...f, bl: e.target.value, fl: "ALL", ct: "ALL" }))} style={ss}><option value="ALL">Tất cả Block</option>{bls.map(b => <option key={b}>{b}</option>)}</select>
              <select value={dashFl.fl} onChange={e => setDashFl(f => ({ ...f, fl: e.target.value, ct: "ALL" }))} style={ss}><option value="ALL">Tất cả Tầng</option>{dashFls.map(f => <option key={f}>{f}</option>)}</select>
              <select value={dashFl.ct} onChange={e => setDashFl(f => ({ ...f, ct: e.target.value }))} style={ss}><option value="ALL">Tất cả HM</option>{dashCts.map(c => <option key={c}>{c}</option>)}</select>
              {hasDashFilter && <><button onClick={() => setDashFl({ bl: "ALL", fl: "ALL", ct: "ALL", dp: "ALL" })} style={{ ...ss, color: "#F87171", border: "1px solid #F87171", cursor: "pointer", fontSize: 11 }}>✕ Xóa lọc</button><span style={{ fontSize: 10, color: "var(--text-dim)" }}>({dashItems.length}/{items.length})</span></>}
            </div>

            {/* Header */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 10 }}>
              <div style={{ background: "var(--surface)", borderRadius: 10, padding: "14px 18px", border: "1px solid var(--border)", borderLeft: "3px solid #B08D57" }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text)", marginBottom: 6 }}>BÁO CÁO THEO DÕI RFI & TIẾN ĐỘ SHOPDRAWING</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2, fontSize: 11, color: "var(--text-muted)" }}>
                  <div><span style={{ color: "var(--text-dim)" }}>DỰ ÁN:</span> Wealthcons</div>
                  <div><span style={{ color: "var(--text-dim)" }}>CẬP NHẬT:</span> {fmFull(td())}</div>
                </div>
              </div>
              <div style={{ background: "var(--surface)", borderRadius: 10, padding: "14px 18px", minWidth: 160, border: "1px solid var(--border)" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", marginBottom: 8 }}>ĐÁNH GIÁ CHUNG</div>
                {[["SHOPDRAWING", pct >= 80], ["RFI", rfiItemsDash.length > 0 ? rfiClosedPct >= 80 : true]].map(pair => {
                  const [label, isOk] = pair;
                  return <div key={label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 11, color: "var(--text)" }}>{label}</span>
                    <span style={{ padding: "2px 10px", borderRadius: 12, fontSize: 10, fontWeight: 700, background: isOk ? "#D1FAE5" : "#FEE2E2", color: isOk ? "#059669" : "#DC2626" }}>{isOk ? "ĐÚNG HẠN" : "CHẬM"}</span>
                  </div>;
                })}
              </div>
              <div style={{ background: "var(--surface)", borderRadius: 10, padding: "14px 18px", minWidth: 200, border: "1px solid var(--border)" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", marginBottom: 8 }}>GHI CHÚ</div>
                <div style={{ fontSize: 10, color: "var(--text)", lineHeight: 1.6 }}>
                  {totalOverdue > 0 && <div>• RFI quá hạn cần xử lý: {rfiOverdue} mục</div>}
                  {sdOverdue > 0 && <div>• SD trễ hạn: {sdOverdue} mục</div>}
                  {totalOverdue === 0 && <div>• Tất cả đang đúng tiến độ ✓</div>}
                </div>
              </div>
            </div>

            {/* 8 cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 8 }}>
              {[
                { icon: "📝", label: "TỔNG SỐ RFI", value: rfiItemsDash.length, sub: "100%", color: "#1E3A5F" },
                { icon: "✅", label: "RFI ĐÃ TRẢ LỜI", value: rfiClosed, sub: rfiClosedPct + "%", color: "#059669" },
                { icon: "⏳", label: "RFI CHỜ TRẢ LỜI", value: rfiOpen, sub: rfiOpenPct + "%", color: "#D97706" },
                { icon: "⚠️", label: "RFI QUÁ HẠN", value: rfiOverdue, sub: rfiOverduePct + "%", color: "#DC2626" },
                { icon: "📐", label: "TỔNG SỐ SD", value: sdItemsDash.length, sub: "100%", color: "#1E3A5F" },
                { icon: "✅", label: "ĐÃ PHÊ DUYỆT", value: sdApproved, sub: sdPct2 + "%", color: "#059669" },
                { icon: "⚙️", label: "ĐANG THỰC HIỆN", value: sdPending, sub: sdPendPct + "%", color: "#D97706" },
                { icon: "❌", label: "CHƯA BẮT ĐẦU", value: sdItemsDash.filter(i => i.status === "DANG_VE" && !i.actualDate).length, sub: (sdItemsDash.length ? Math.round(sdItemsDash.filter(i => i.status === "DANG_VE" && !i.actualDate).length / sdItemsDash.length * 100) : 0) + "%", color: "#DC2626" },
              ].map((card, i) => <div key={i} style={{ background: "var(--surface)", borderRadius: 10, padding: "12px 10px", textAlign: "center", borderBottom: "3px solid " + card.color, border: "1px solid var(--border)", borderBottomColor: card.color, borderBottomWidth: 3 }}>
                <div style={{ fontSize: 18, marginBottom: 4 }}>{card.icon}</div>
                <div style={{ fontSize: 8, fontWeight: 700, color: "var(--text-muted)", marginBottom: 4, letterSpacing: 0.5 }}>{card.label}</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: card.color, fontFamily: "'JetBrains Mono'" }}>{card.value}</div>
                <div style={{ fontSize: 10, color: "var(--text-dim)" }}>{card.sub}</div>
              </div>)}
            </div>

            {/* Two panels */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {/* RFI */}
              <div style={{ background: "var(--surface)", borderRadius: 10, padding: 16, border: "1px solid var(--border)" }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text)", marginBottom: 14, paddingBottom: 8, borderBottom: "2px solid #B08D57" }}>THEO DÕI RFI</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 14 }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", marginBottom: 8 }}>TRẠNG THÁI RFI</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <Donut data={[{ l: "Đã trả lời", v: rfiClosed, c: "#059669" }, { l: "Chờ trả lời", v: rfiOpen - rfiOverdue, c: "#D97706" }, { l: "Quá hạn", v: rfiOverdue, c: "#DC2626" }]} size={100} />
                      <div style={{ fontSize: 10 }}>
                        {[{ l: "Đã trả lời", v: rfiClosed, p: rfiClosedPct, c: "#059669" }, { l: "Chờ trả lời", v: rfiOpen - rfiOverdue, p: rfiItemsDash.length ? Math.round((rfiOpen - rfiOverdue) / rfiItemsDash.length * 100) : 0, c: "#D97706" }, { l: "Quá hạn", v: rfiOverdue, p: rfiOverduePct, c: "#DC2626" }].map((d, i) => <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 3 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: d.c }} /><span style={{ color: "var(--text-muted)" }}>{d.l} {d.v} ({d.p}%)</span></div>)}
                      </div>
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", marginBottom: 8 }}>RFI THEO THỜI GIAN</div>
                    {trendData ? <TrendChart data={trendData.series} labels={trendData.labels} h={120} /> : <div style={{ color: "var(--text-dim)", fontSize: 11, padding: 20, textAlign: "center" }}>Cần 2+ tuần dữ liệu</div>}
                  </div>
                </div>
              </div>
              {/* SD */}
              <div style={{ background: "var(--surface)", borderRadius: 10, padding: 16, border: "1px solid var(--border)" }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text)", marginBottom: 14, paddingBottom: 8, borderBottom: "2px solid #B08D57" }}>THEO DÕI TIẾN ĐỘ SHOPDRAWING</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 14 }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", marginBottom: 8 }}>TÌNH TRẠNG SD</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <Donut data={[{ l: "Đã phê duyệt", v: sdApproved, c: "#059669" }, { l: "Đang thực hiện", v: sdPending, c: "#D97706" }, { l: "Chưa bắt đầu", v: sdItemsDash.filter(i => i.status === "DANG_VE" && !i.actualDate).length, c: "#DC2626" }]} size={100} />
                      <div style={{ fontSize: 10 }}>
                        {[{ l: "Đã phê duyệt", v: sdApproved, p: sdPct2, c: "#059669" }, { l: "Đang thực hiện", v: sdPending, p: sdPendPct, c: "#D97706" }, { l: "Chưa bắt đầu", v: sdItemsDash.filter(i => i.status === "DANG_VE" && !i.actualDate).length, p: sdItemsDash.length ? Math.round(sdItemsDash.filter(i => i.status === "DANG_VE" && !i.actualDate).length / sdItemsDash.length * 100) : 0, c: "#DC2626" }].map((d, i) => <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 3 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: d.c }} /><span style={{ color: "var(--text-muted)" }}>{d.l} {d.v} ({d.p}%)</span></div>)}
                      </div>
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", marginBottom: 8 }}>TIẾN ĐỘ SD</div>
                    {[["Hoàn thành", sdPct2, "#059669"], ["Đang xử lý", sdPendPct, "#D97706"], ["Trễ hạn", sdOverduePct, "#DC2626"]].map(([lbl, val, c]) => <div key={lbl} style={{ marginBottom: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                        <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{lbl}</span>
                        <span style={{ fontSize: 14, fontWeight: 800, color: c, fontFamily: "'JetBrains Mono'" }}>{val}%</span>
                      </div>
                      <div style={{ height: 8, borderRadius: 4, background: "var(--surface2)", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: val + "%", background: c, borderRadius: 4 }} />
                      </div>
                    </div>)}
                  </div>
                </div>
              </div>
            </div>

            {/* KPI Row */}
            <div style={{ background: "var(--surface)", borderRadius: 10, padding: 16, border: "1px solid var(--border)" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 10, paddingBottom: 6, borderBottom: "1px solid var(--border)" }}>🎯 CHỈ SỐ KPI</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                <KPICard label="Tỷ lệ hoàn thành" value={kpiData.completionPct} target={85} unit="%" icon="📊" />
                <KPICard label="RFI đúng hạn" value={kpiData.rfiOnTimePct} target={85} unit="%" icon="⏰" />
                <KPICard label="Phản hồi TB" value={kpiData.avgResponseTime} target={7} unit=" ngày" icon="⏱️" />
                <KPICard label="SD duyệt lần đầu" value={kpiData.sdFirstPassPct} target={70} unit="%" icon="✅" />
                <KPICard label="Trễ trên đường găng" value={kpiData.lateOnCritical} target={0} unit="" icon="🚨" />
                <KPICard label="RFI đang mở" value={rfiOpen} target={5} unit="" icon="📝" />
              </div>
            </div>

            {/* Overdue RFI list */}
            <div style={{ background: "var(--surface)", borderRadius: 10, padding: 14, borderLeft: "3px solid #DC2626", border: "1px solid var(--border)", borderLeftColor: "#DC2626", borderLeftWidth: 3 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#DC2626", marginBottom: 8 }}>DANH SÁCH RFI QUÁ HẠN ({alerts.filter(i => i.type === "RFI").length})</div>
              {!alerts.filter(i => i.type === "RFI").length ? <div style={{ fontSize: 12, color: "var(--text-dim)", padding: 16, textAlign: "center" }}>Không có RFI quá hạn 🎉</div> :
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                    <thead><tr style={{ background: "var(--surface2)" }}>
                      {["STT", "Mã RFI", "Nội dung", "Ngày gửi", "Hạn", "Quá hạn"].map((h, i) => <th key={i} style={{ padding: "6px 8px", textAlign: "left", fontWeight: 600, color: "var(--text-muted)", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>{h}</th>)}
                    </tr></thead>
                    <tbody>{alerts.filter(i => i.type === "RFI").slice(0, 10).map((it, i) => {
                      const delay = ld(it);
                      return <tr key={it.id} onClick={() => setDetId(it.id)} style={{ cursor: "pointer", borderBottom: "1px solid var(--border)" }}
                        onMouseEnter={e => e.currentTarget.style.background = "var(--hover)"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                        <td style={{ padding: "6px 8px" }}>{i + 1}</td>
                        <td style={{ padding: "6px 8px", fontWeight: 700, fontFamily: "'JetBrains Mono'", whiteSpace: "nowrap" }}>{it.code}</td>
                        <td style={{ padding: "6px 8px", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</td>
                        <td style={{ padding: "6px 8px", fontFamily: "'JetBrains Mono'", whiteSpace: "nowrap" }}>{fmFull(it.actualDate)}</td>
                        <td style={{ padding: "6px 8px", fontFamily: "'JetBrains Mono'", whiteSpace: "nowrap" }}>{fmFull(apprPlan(it))}</td>
                        <td style={{ padding: "6px 8px" }}><span style={{ padding: "2px 8px", borderRadius: 10, fontSize: 10, fontWeight: 700, background: "#FEE2E2", color: "#DC2626" }}>{delay > 0 ? delay + " ngày" : "—"}</span></td>
                      </tr>;
                    })}</tbody>
                  </table>
                </div>}
            </div>
          </div>}

          {/* ═══ RFI / SD OVERVIEW ═══ */}
          {(page === "rfi_overview" || page === "sd_overview") && <TypeOverview type={page === "rfi_overview" ? "RFI" : "SD"} items={dashItems} dashFl={dashFl} setDashFl={setDashFl} bls={bls} dashFls={dashFls} dashCts={dashCts} onDetail={id => setDetId(id)} />}

          {/* ═══ RFI ANALYSIS ═══ */}
          {page === "rfi_analysis" && <RfiAnalysisPage rootCauseData={rootCauseData} trendData={trendData} responseTimeAnalysis={responseTimeAnalysis} actionItems={actionItems} onDetail={id => setDetId(id)} />}

          {/* ═══ LIST PAGES (sd_list, sd_pending, rfi_list, rfi_overdue) ═══ */}
          {["sd_list", "sd_pending", "sd_late_submit", "rfi_list", "rfi_overdue"].includes(page) && <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ background: "var(--surface)", borderRadius: 10, padding: 10, border: "1px solid var(--border)", display: "flex", gap: 5, flexWrap: "wrap" }}>
              <input placeholder="🔍 Tìm..." value={fl.q} onChange={e => setFl(f => ({ ...f, q: e.target.value }))} style={{ ...ss, flex: 1, minWidth: 100 }} />
              <select value={fl.dp} onChange={e => setFl(f => ({ ...f, dp: e.target.value }))} style={ss}><option value="ALL">Bộ phận</option>{DEPTS.map(d => <option key={d.k} value={d.k}>{d.l}</option>)}</select>
              <select value={fl.bl} onChange={e => setFl(f => ({ ...f, bl: e.target.value }))} style={ss}><option value="ALL">Block</option>{bls.map(b => <option key={b}>{b}</option>)}</select>
              <select value={fl.fl} onChange={e => setFl(f => ({ ...f, fl: e.target.value }))} style={ss}><option value="ALL">Tầng</option>{fls.map(f => <option key={f}>{f}</option>)}</select>
              <select value={fl.ct} onChange={e => setFl(f => ({ ...f, ct: e.target.value }))} style={ss}><option value="ALL">Hạng mục</option>{cts.map(c => <option key={c}>{c}</option>)}</select>
              <select value={fl.wh} onChange={e => setFl(f => ({ ...f, wh: e.target.value }))} style={ss}><option value="ALL">Người</option>{ppl.map(p => <option key={p}>{p}</option>)}</select>
              <select value={fl.st} onChange={e => setFl(f => ({ ...f, st: e.target.value }))} style={ss}><option value="ALL">Trạng thái</option>{getStatusList(pageListType).map(s => <option key={s.k} value={s.k}>{s.l}</option>)}</select>
              <select value={fl.rk} onChange={e => setFl(f => ({ ...f, rk: e.target.value }))} style={ss}><option value="ALL">Rủi ro</option>{Object.entries(RC).map(([k, v]) => <option key={k} value={k}>{v.i}{v.l}</option>)}</select>
              {Object.values(fl).some(v => v !== "ALL" && v !== "") && <button onClick={() => setFl({ st: "ALL", rk: "ALL", bl: "ALL", ct: "ALL", wh: "ALL", fl: "ALL", dp: "ALL", q: "" })} style={{ ...ss, color: "#F87171", border: "1px solid #F87171", cursor: "pointer" }}>✕</button>}
            </div>

            {selected.size > 0 && canDel && <div style={{ background: "#FEE2E2", color: "#DC2626", padding: "6px 10px", borderRadius: 6, fontSize: 11, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontWeight: 700 }}>Đã chọn {selected.size} mục</span>
              <button onClick={deleteSelected} style={{ padding: "4px 10px", borderRadius: 5, border: "none", background: "#DC2626", color: "#fff", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>🗑 Xóa</button>
              <button onClick={() => setSelected(new Set())} style={{ padding: "4px 10px", borderRadius: 5, border: "1px solid #DC2626", background: "transparent", color: "#DC2626", fontSize: 10, cursor: "pointer" }}>Bỏ chọn</button>
            </div>}

            <div style={{ background: "var(--surface)", borderRadius: 10, border: "1px solid var(--border)", overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead><tr style={{ background: "var(--surface2)" }}>
                  {canDel && <th style={{ padding: "8px 6px", width: 30 }}><input type="checkbox" checked={sorted.length > 0 && sorted.every(i => selected.has(i.id))} onChange={toggleSelectAll} /></th>}
                  {COL_LABELS.map(col => <th key={col} onClick={() => toggleSort(col)} style={{ padding: "8px 6px", textAlign: "left", fontWeight: 700, color: "var(--text-muted)", borderBottom: "1px solid var(--border)", fontSize: 10, whiteSpace: "nowrap", cursor: "pointer", userSelect: "none" }}>
                    {col} {sortCol === SORT_KEYS[col] && (sortDir === "asc" ? "▲" : "▼")}
                  </th>)}
                  <th style={{ padding: "8px 6px", width: 30 }}>🔗</th>
                  <th style={{ padding: "8px 6px", width: 30 }}>📝</th>
                </tr></thead>
                <tbody>{sorted.map(it => {
                  const st = getStatusItem(it.type, it.status); const r = rsk(it); const rc = RC[r]; const l = ld(it); const ap = apprPlan(it); const sd = subDelay(it);
                  const lk = (it.links || []); const dpt = DEPTS.find(d => d.k === it.dept);
                  const rcItem = ROOT_CAUSES.find(x => x.k === it.rootCause);
                  const stList = getStatusList(it.type);
                  return <tr key={it.id} style={{ borderBottom: "1px solid var(--border)", background: selected.has(it.id) ? "rgba(176,141,87,0.08)" : "transparent" }}
                    onMouseEnter={e => { if (!selected.has(it.id)) e.currentTarget.style.background = "var(--hover)"; }}
                    onMouseLeave={e => { if (!selected.has(it.id)) e.currentTarget.style.background = "transparent"; }}>
                    {canDel && <td style={{ padding: "6px 4px" }}><input type="checkbox" checked={selected.has(it.id)} onChange={e => toggleSelect(it.id, e.nativeEvent.shiftKey)} onClick={e => e.stopPropagation()} /></td>}
                    <td style={{ padding: "6px 4px", fontFamily: "'JetBrains Mono'", fontWeight: 700, cursor: "pointer", color: "#1E3A5F" }} onClick={() => setDetId(it.id)}>
                      {r === "late" ? "🔴 " : r === "high" ? "🟠 " : ""}{it.code}
                    </td>
                    <td style={{ padding: "6px 4px", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer" }} onClick={() => setDetId(it.id)}>{it.name || "—"}</td>
                    <td style={{ padding: "6px 4px", cursor: "pointer" }} onClick={() => setDetId(it.id)}>{it.block || "—"}</td>
                    <td style={{ padding: "6px 4px", cursor: "pointer" }} onClick={() => setDetId(it.id)}>{it.floor || "—"}</td>
                    <td style={{ padding: "6px 4px", cursor: "pointer" }} onClick={() => setDetId(it.id)}><Bd c={dpt?.c || "#6B7280"} bg={dpt?.bg || "#F3F4F6"}>{it.dept || "—"}</Bd></td>
                    <td style={{ padding: "6px 4px", cursor: "pointer" }} onClick={() => setDetId(it.id)}>{it.cat || "—"}</td>
                    <td style={{ padding: "6px 4px", cursor: "pointer" }} onClick={() => setDetId(it.id)}>{it.who || "—"}</td>
                    <td style={{ padding: "6px 4px", cursor: "pointer" }} onClick={() => setDetId(it.id)}>{it.sub || "—"}</td>
                    <td style={{ padding: "6px 4px" }} onClick={e => e.stopPropagation()}>
                      {canEd ? <select value={it.status} onChange={e => handleStatusChange(it.id, e.target.value)} style={{ padding: "2px 4px", borderRadius: 8, border: "none", background: st?.bg || "#F3F4F6", color: st?.c || "#6B7280", fontSize: 10, fontWeight: 600, cursor: "pointer" }}>{stList.map(s => <option key={s.k} value={s.k}>{s.l}</option>)}</select>
                        : <Bd c={st?.c} bg={st?.bg}>{st?.l || it.status}</Bd>}
                    </td>
                    {pageListType === "SD" && <td style={{ padding: "6px 4px", fontFamily: "'JetBrains Mono'", fontSize: 10, cursor: "pointer" }} onClick={() => setDetId(it.id)}>{fm(it.planDate)}</td>}
                    <td style={{ padding: "6px 4px", fontFamily: "'JetBrains Mono'", fontSize: 10, cursor: "pointer" }} onClick={() => setDetId(it.id)}>{fm(it.actualDate)}</td>
                    {pageListType === "SD" && <td style={{ padding: "6px 4px", cursor: "pointer" }} onClick={() => setDetId(it.id)}>{sd > 0 ? <Bd c="#EA580C" bg="#FFEDD5">+{sd}</Bd> : sd === 0 ? <span style={{ color: "var(--text-dim)" }}>0</span> : "—"}</td>}
                    <td style={{ padding: "6px 4px", fontFamily: "'JetBrains Mono'", fontSize: 10, cursor: "pointer" }} onClick={() => setDetId(it.id)}>{fm(ap)}</td>
                    <td style={{ padding: "6px 4px", fontFamily: "'JetBrains Mono'", fontSize: 10, cursor: "pointer" }} onClick={() => setDetId(it.id)}>{fm(it.approveDate)}</td>
                    <td style={{ padding: "6px 4px", cursor: "pointer" }} onClick={() => setDetId(it.id)}>{l > 0 ? <Bd c="#DC2626" bg="#FEE2E2">+{l}</Bd> : l === 0 ? <span style={{ color: "var(--text-dim)" }}>0</span> : "—"}</td>
                    {pageListType === "RFI" && <td style={{ padding: "6px 4px", cursor: "pointer" }} onClick={() => setDetId(it.id)}>{rcItem ? <Bd c={rcItem.c} bg={rcItem.bg}>{rcItem.l}</Bd> : "—"}</td>}
                    <td style={{ padding: "6px 4px", cursor: "pointer" }} onClick={() => setDetId(it.id)}>{lk.length > 0 && <span style={{ color: "#1E3A5F" }}>🔗{lk.length}</span>}</td>
                    <td style={{ padding: "6px 4px", cursor: "pointer" }} onClick={() => setDetId(it.id)}>{(it.notes || []).length > 0 && <span style={{ color: "#B08D57" }}>📝{it.notes.length}</span>}</td>
                  </tr>;
                })}</tbody>
              </table>
              {!sorted.length && <div style={{ padding: 40, textAlign: "center", color: "var(--text-dim)" }}>Không có dữ liệu</div>}
            </div>
          </div>}

          {/* ═══ WEEK PLAN ═══ */}
          {page === "week_plan" && <WeekPlanPage weekMonday={weekMonday} setWeekMonday={setWeekMonday} weekPlan={weekPlan} onDetail={id => setDetId(id)} />}

          {/* ═══ REPORT PAGES ═══ */}
          {page === "report_summary" && <ReportSummaryPage items={items} stats={fullStats} projectCfg={projectCfg} />}
          {page === "report_export" && <ReportExportPage onShowExport={() => setShowExport(true)} onShowImport={canImp ? () => setShowImport(true) : null} />}

          {/* ═══ SETTINGS ═══ */}
          {page === "settings_project" && userRole === "owner" && <SettingsProjectPage showToast={showToast} />}
          {page === "settings_users" && userRole === "owner" && <UserManagement />}
          {page === "settings_roles" && userRole === "owner" && <SettingsRolesPage />}

        </div>
      </main>
    </div>
  </>;
}

// ─── Page Title helper ───
function getPageTitle(page) {
  const titles = {
    overview: "🏠 Tổng quan dự án",
    sd_overview: "📊 Tổng quan SHOPDRAWING",
    sd_list: "📋 Danh sách SHOPDRAWING",
    sd_pending: "⏳ SD chưa phê duyệt",
    sd_late_submit: "⚠️ SD chậm đệ trình",
    rfi_overview: "📊 Tổng quan RFI",
    rfi_list: "📋 Danh sách RFI",
    rfi_overdue: "⚠️ RFI quá hạn",
    rfi_analysis: "🔍 Phân tích RFI",
    report_summary: "📑 Báo cáo tổng hợp",
    report_export: "📤 Xuất dữ liệu",
    week_plan: "📅 Kế hoạch tuần",
    settings_project: "🏗️ Cài đặt dự án",
    settings_users: "👤 Quản lý người dùng",
    settings_roles: "🔐 Vai trò & phân quyền",
  };
  return titles[page] || "SHOPDRAWING STUDIO";
}

// ─── Theme CSS ───
function themeCSS(theme) {
  const t = THEMES[theme];
  return `
    @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap');
    :root {
      --bg: ${t.bg}; --surface: ${t.surface}; --surface2: ${t.surface2}; --border: ${t.border};
      --text: ${t.text}; --text-muted: ${t.textMuted}; --text-dim: ${t.textDim};
      --primary: ${t.primary}; --primary-light: ${t.primaryLight}; --primary-dark: ${t.primaryDark};
      --navy: ${t.navy}; --navy-light: ${t.navyLight};
      --hover: ${t.hover}; --sidebar: ${t.sidebar}; --sidebar-active: ${t.sidebarActive};
    }
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:${t.bg};color:${t.text};font-family:'Plus Jakarta Sans',sans-serif}
    input,select,textarea{font-family:inherit}
    ::-webkit-scrollbar{width:6px;height:6px}
    ::-webkit-scrollbar-thumb{background:${t.border};border-radius:3px}
    ::-webkit-scrollbar-thumb:hover{background:${t.primary}}
    ::-webkit-scrollbar-track{background:${t.bg}}
  `;
}

// ═══════════════════════════════════════════════════════════════
// ─── TYPE OVERVIEW (RFI or SD) ───
// ═══════════════════════════════════════════════════════════════
function TypeOverview({ type, items, dashFl, setDashFl, bls, dashFls, dashCts, onDetail }) {
  const ss = { padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12 };
  const filtered = items.filter(i => i.type === type);
  const done = filtered.filter(i => isDone(i)).length;
  const open = filtered.filter(i => !isDone(i) && i.status !== "REJECT").length;
  const overdue = filtered.filter(i => rsk(i) === "late").length;
  const tot = filtered.length;
  const pct = tot ? Math.round(done / tot * 100) : 0;

  const byStatus = {};
  getStatusList(type).forEach(s => byStatus[s.k] = filtered.filter(i => i.status === s.k).length);

  const byBlock = {};
  filtered.forEach(i => { if (i.block) byBlock[i.block] = (byBlock[i.block] || 0) + 1; });

  const byDept = {};
  DEPTS.forEach(d => byDept[d.k] = filtered.filter(i => i.dept === d.k).length);

  const hasFilter = dashFl.bl !== "ALL" || dashFl.fl !== "ALL" || dashFl.ct !== "ALL" || dashFl.dp !== "ALL";

  return <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
    {/* Filters */}
    <div style={{ background: "var(--surface)", borderRadius: 10, padding: "10px 12px", border: "1px solid var(--border)", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>🔎 Lọc:</span>
      <select value={dashFl.dp} onChange={e => setDashFl(f => ({ ...f, dp: e.target.value }))} style={ss}><option value="ALL">Tất cả BP</option>{DEPTS.map(d => <option key={d.k} value={d.k}>{d.l}</option>)}</select>
      <select value={dashFl.bl} onChange={e => setDashFl(f => ({ ...f, bl: e.target.value, fl: "ALL", ct: "ALL" }))} style={ss}><option value="ALL">Tất cả Block</option>{bls.map(b => <option key={b}>{b}</option>)}</select>
      <select value={dashFl.fl} onChange={e => setDashFl(f => ({ ...f, fl: e.target.value, ct: "ALL" }))} style={ss}><option value="ALL">Tất cả Tầng</option>{dashFls.map(f => <option key={f}>{f}</option>)}</select>
      <select value={dashFl.ct} onChange={e => setDashFl(f => ({ ...f, ct: e.target.value }))} style={ss}><option value="ALL">Tất cả HM</option>{dashCts.map(c => <option key={c}>{c}</option>)}</select>
      {hasFilter && <button onClick={() => setDashFl({ bl: "ALL", fl: "ALL", ct: "ALL", dp: "ALL" })} style={{ ...ss, color: "#F87171", border: "1px solid #F87171", cursor: "pointer", fontSize: 11 }}>✕ Xóa</button>}
    </div>

    {/* KPI cards */}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
      {[
        { l: `Tổng số ${type}`, v: tot, c: "#1E3A5F" },
        { l: type === "RFI" ? "Đã đóng" : "Đã phê duyệt", v: done, c: "#059669", sub: pct + "%" },
        { l: type === "RFI" ? "Đang mở" : "Đang xử lý", v: open, c: "#D97706" },
        { l: "Quá hạn", v: overdue, c: "#DC2626" },
      ].map((c, i) => <div key={i} style={{ background: "var(--surface)", borderRadius: 10, padding: "14px 16px", border: "1px solid var(--border)", borderLeft: `3px solid ${c.c}` }}>
        <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 700, letterSpacing: 0.5 }}>{c.l.toUpperCase()}</div>
        <div style={{ fontSize: 28, fontWeight: 800, color: c.c, fontFamily: "'JetBrains Mono'", marginTop: 4 }}>{c.v}</div>
        {c.sub && <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{c.sub}</div>}
      </div>)}
    </div>

    {/* Charts */}
    <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: 10 }}>
      <div style={{ background: "var(--surface)", borderRadius: 10, padding: 14, border: "1px solid var(--border)" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", marginBottom: 10 }}>Phân bố trạng thái</div>
        <Bar data={Object.entries(byStatus).map(([k, v]) => ({ l: getStatusItem(type, k)?.l || k, v, c: getStatusItem(type, k)?.c || "#6B7280" }))} h={140} />
      </div>
      <div style={{ background: "var(--surface)", borderRadius: 10, padding: 14, border: "1px solid var(--border)" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", marginBottom: 10 }}>Theo Block</div>
        <Bar data={Object.entries(byBlock).map(([l, v]) => ({ l, v, c: "#1E3A5F" }))} h={140} />
      </div>
      <div style={{ background: "var(--surface)", borderRadius: 10, padding: 14, border: "1px solid var(--border)" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", marginBottom: 10 }}>Theo Bộ phận</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Donut data={DEPTS.map(d => ({ l: d.l, v: byDept[d.k] || 0, c: d.c }))} size={120} />
          <div style={{ fontSize: 11 }}>
            {DEPTS.map(d => <div key={d.k} style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 3 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: d.c }} />
              <span style={{ color: "var(--text-muted)" }}>{d.l}: <b>{byDept[d.k] || 0}</b></span>
            </div>)}
          </div>
        </div>
      </div>
    </div>

    {/* Recent items */}
    <div style={{ background: "var(--surface)", borderRadius: 10, padding: 14, border: "1px solid var(--border)" }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", marginBottom: 10 }}>{type} gần đây (10 mục mới nhất)</div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead><tr style={{ background: "var(--surface2)" }}>{["Mã", "Tên", "Block", "BP", "Hạng mục", "Trạng thái", type === "SD" ? "KH nộp" : "Ngày gửi"].map(h => <th key={h} style={{ padding: "6px 8px", textAlign: "left", color: "var(--text-muted)", fontWeight: 600, fontSize: 10, borderBottom: "1px solid var(--border)" }}>{h}</th>)}</tr></thead>
          <tbody>{filtered.slice().sort((a, b) => (b.actualDate || b.planDate || "").localeCompare(a.actualDate || a.planDate || "")).slice(0, 10).map(it => {
            const st = getStatusItem(type, it.status); const dpt = DEPTS.find(d => d.k === it.dept);
            return <tr key={it.id} onClick={() => onDetail(it.id)} style={{ cursor: "pointer", borderBottom: "1px solid var(--border)" }}
              onMouseEnter={e => e.currentTarget.style.background = "var(--hover)"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <td style={{ padding: "6px 8px", fontFamily: "'JetBrains Mono'", fontWeight: 700, color: "#1E3A5F" }}>{it.code}</td>
              <td style={{ padding: "6px 8px", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</td>
              <td style={{ padding: "6px 8px" }}>{it.block}</td>
              <td style={{ padding: "6px 8px" }}><Bd c={dpt?.c} bg={dpt?.bg}>{it.dept}</Bd></td>
              <td style={{ padding: "6px 8px" }}>{it.cat}</td>
              <td style={{ padding: "6px 8px" }}><Bd c={st?.c} bg={st?.bg}>{st?.l || it.status}</Bd></td>
              <td style={{ padding: "6px 8px", fontFamily: "'JetBrains Mono'", fontSize: 10 }}>{fmFull(type === "SD" ? it.planDate : it.actualDate)}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
    </div>
  </div>;
}

// ═══════════════════════════════════════════════════════════════
// ─── RFI ANALYSIS PAGE ───
// ═══════════════════════════════════════════════════════════════
function RfiAnalysisPage({ rootCauseData, trendData, responseTimeAnalysis, actionItems, onDetail }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
      {/* Trend */}
      <div style={{ background: "var(--surface)", borderRadius: 10, padding: 14, border: "1px solid var(--border)" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 10, paddingBottom: 6, borderBottom: "2px solid #B08D57" }}>📈 Xu hướng RFI theo tuần</div>
        {trendData ? <><TrendChart data={trendData.series} labels={trendData.labels} h={180} />
          <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 8 }}>
            {trendData.series.map((s, i) => <div key={i} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-muted)" }}>
              <span style={{ width: 12, height: 3, borderRadius: 2, background: s.color }} />{s.label}
            </div>)}
          </div></> : <div style={{ color: "var(--text-dim)", fontSize: 12, padding: 30, textAlign: "center" }}>Cần ít nhất 2 tuần dữ liệu</div>}
      </div>

      {/* Root cause */}
      <div style={{ background: "var(--surface)", borderRadius: 10, padding: 14, border: "1px solid var(--border)" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 10, paddingBottom: 6, borderBottom: "2px solid #B08D57" }}>🔍 Phân tích nguyên nhân RFI</div>
        {rootCauseData.length === 0 ? <div style={{ color: "var(--text-dim)", fontSize: 12, padding: 30, textAlign: "center" }}>Chưa có dữ liệu nguyên nhân</div> :
          <><div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Donut data={rootCauseData.map(rc => ({ l: rc.l, v: rc.count, c: rc.c }))} size={130} />
            <div style={{ flex: 1 }}>
              {rootCauseData.map((rc, i) => {
                const totalRC = rootCauseData.reduce((s, r) => s + r.count, 0);
                const pctRC = totalRC ? Math.round(rc.count / totalRC * 100) : 0;
                return <div key={i} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, marginBottom: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: rc.c, flexShrink: 0 }} />
                  <span style={{ color: "var(--text-muted)", flex: 1 }}>{rc.l}</span>
                  <span style={{ fontWeight: 700, fontFamily: "'JetBrains Mono'", color: "var(--text)" }}>{rc.count} ({pctRC}%)</span>
                </div>;
              })}
            </div>
          </div>
            <div style={{ marginTop: 12, padding: "10px 12px", background: "var(--surface2)", borderRadius: 8, fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6 }}>
              💡 {rootCauseData[0] && `Nguyên nhân chính: "${rootCauseData[0].l}" chiếm ${Math.round(rootCauseData[0].count / rootCauseData.reduce((s, r) => s + r.count, 0) * 100)}% tổng RFI có phân loại`}
            </div></>}
      </div>
    </div>

    {/* Response time */}
    <div style={{ background: "var(--surface)", borderRadius: 10, padding: 14, border: "1px solid var(--border)" }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 10 }}>⏱️ Thời gian phản hồi theo người chịu TN</div>
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <div style={{ fontSize: 32, fontWeight: 800, color: "#1E3A5F", fontFamily: "'JetBrains Mono'" }}>{responseTimeAnalysis.avgResponseTime}<span style={{ fontSize: 12, color: "var(--text-dim)", fontWeight: 400 }}> ngày TB</span></div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
          {Object.entries(responseTimeAnalysis.byOwner).map(([owner, data], i) => <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 10px", background: "var(--surface2)", borderRadius: 6, fontSize: 11 }}>
            <span style={{ color: "var(--text-muted)" }}>{owner}</span>
            <span style={{ fontWeight: 700, color: data.avg > 7 ? "#DC2626" : data.avg > 3 ? "#F59E0B" : "#059669", fontFamily: "'JetBrains Mono'" }}>{data.avg}d</span>
          </div>)}
          {!Object.keys(responseTimeAnalysis.byOwner).length && <div style={{ color: "var(--text-dim)", fontSize: 11, textAlign: "center", padding: 10 }}>Chưa có dữ liệu</div>}
        </div>
      </div>
    </div>

    {/* Action items */}
    <div style={{ background: "var(--surface)", borderRadius: 10, padding: 14, border: "1px solid var(--border)" }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 10 }}>📋 Bảng hành động — RFI đang mở ({actionItems.length})</div>
      {!actionItems.length ? <div style={{ padding: 30, textAlign: "center", color: "var(--text-dim)", fontSize: 12 }}>Không có RFI đang mở 🎉</div> :
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead><tr style={{ background: "var(--surface2)" }}>{["", "Mã", "Tên RFI", "Nguyên nhân", "Người chịu TN", "Deadline", "Trạng thái", "Delay"].map((h, i) => <th key={i} style={{ padding: "8px 6px", textAlign: "left", fontWeight: 600, color: "var(--text-muted)", whiteSpace: "nowrap", borderBottom: "1px solid var(--border)", fontSize: 10 }}>{h}</th>)}</tr></thead>
            <tbody>
              {actionItems.map(it => {
                const l = ld(it);
                const actSt = ACTION_STATUS.find(s => s.k === it.actionStatus) || ACTION_STATUS[2];
                const rcItem = ROOT_CAUSES.find(rc => rc.k === it.rootCause);
                return <tr key={it.id} onClick={() => onDetail(it.id)} style={{ cursor: "pointer", borderBottom: "1px solid var(--border)", background: it.isOverdue ? "rgba(220,38,38,.08)" : "transparent" }}>
                  <td style={{ padding: "8px 6px" }}>{it.isOverdue ? "🔴" : "🟡"}</td>
                  <td style={{ padding: "8px 6px", fontWeight: 700, fontFamily: "'JetBrains Mono'", fontSize: 10 }}>{it.code}</td>
                  <td style={{ padding: "8px 6px", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</td>
                  <td style={{ padding: "8px 6px" }}>{rcItem ? <Bd c={rcItem.c} bg={rcItem.bg}>{rcItem.l}</Bd> : "—"}</td>
                  <td style={{ padding: "8px 6px", fontWeight: 600 }}>{it.actionOwner || "—"}</td>
                  <td style={{ padding: "8px 6px", fontFamily: "'JetBrains Mono'", fontSize: 10, color: it.isOverdue ? "#DC2626" : "var(--text-muted)" }}>{fmFull(it.actionDeadline)}</td>
                  <td style={{ padding: "8px 6px" }}><Bd c={actSt.c} bg={actSt.bg}>{actSt.l}</Bd></td>
                  <td style={{ padding: "8px 6px" }}>{l > 0 ? <Bd c="#DC2626" bg="#FEE2E2">+{l}d</Bd> : l === 0 ? "0" : "—"}</td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>}
    </div>
  </div>;
}

// ═══════════════════════════════════════════════════════════════
// ─── WEEK PLAN PAGE ───
// ═══════════════════════════════════════════════════════════════
function WeekPlanPage({ weekMonday, setWeekMonday, weekPlan, onDetail }) {
  const { overdueUnstarted, weekTasks, byDay, monIso, sunIso } = weekPlan;
  const weekNum = getWeekNumber(monIso);
  const dayNames = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
  const todayIso = td();

  const exportWeekHTML = () => {
    const rows = weekTasks.map(it => {
      const st = getStatusItem(it.type, it.status); const dpt = DEPTS.find(d => d.k === it.dept);
      return `<tr><td style="font-weight:700;font-family:monospace">${it.code}</td><td>${it.name || "—"}</td><td>${it.block}</td><td>${it.floor}</td>
        <td><span style="padding:2px 6px;border-radius:10px;font-size:10px;background:${dpt?.bg || "#F3F4F6"};color:${dpt?.c || "#6B7280"}">${it.dept || "—"}</span></td>
        <td>${it.cat}</td><td>${it.who}</td>
        <td style="font-family:monospace">${fmFull(it.planDate)}</td>
        <td><span style="padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;background:${st?.bg};color:${st?.c}">${st?.l}</span></td></tr>`;
    }).join("");
    const overRows = overdueUnstarted.map(it => {
      const st = getStatusItem(it.type, it.status); const delay = dd(todayIso, it.planDate);
      return `<tr><td style="font-weight:700;font-family:monospace">${it.code}</td><td>${it.name || "—"}</td><td>${it.block}</td><td>${it.cat}</td><td>${it.who}</td>
        <td style="font-family:monospace">${fmFull(it.planDate)}</td>
        <td><span style="color:#DC2626;font-weight:700">${delay} ngày</span></td>
        <td><span style="padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;background:${st?.bg};color:${st?.c}">${st?.l}</span></td></tr>`;
    }).join("");
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Kế hoạch tuần ${weekNum}</title><style>
      body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:1300px;margin:auto;padding:30px;color:#1E293B;background:#F8FAFC}
      h1{color:#1E3A5F;border-bottom:3px solid #B08D57;padding-bottom:10px}
      h2{color:#1E3A5F;margin-top:24px;border-left:4px solid #B08D57;padding-left:10px}
      table{width:100%;border-collapse:collapse;margin-top:10px;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06)}
      th{background:#1E3A5F;color:#fff;padding:10px;text-align:left;font-size:12px}
      td{padding:8px 10px;border-bottom:1px solid #E2E8F0;font-size:12px}
      tr:nth-child(even){background:#F8FAFC}
      .meta{color:#64748B;font-size:12px}
    </style></head><body>
      <h1>📅 SHOPDRAWING STUDIO — Kế hoạch tuần ${weekNum}</h1>
      <div class="meta">Tuần: ${getWeekRange(monIso)} · Wealthcons</div>
      <h2>⚠️ Nhiệm vụ chậm kế hoạch (chưa triển khai) — ${overdueUnstarted.length} mục</h2>
      ${overdueUnstarted.length ? `<table><thead><tr><th>Mã</th><th>Tên</th><th>Block</th><th>HM</th><th>Người vẽ</th><th>KH nộp</th><th>Chậm</th><th>Trạng thái</th></tr></thead><tbody>${overRows}</tbody></table>` : "<p>Không có mục nào.</p>"}
      <h2>📋 Nhiệm vụ thuộc tuần — ${weekTasks.length} mục</h2>
      ${weekTasks.length ? `<table><thead><tr><th>Mã</th><th>Tên</th><th>Block</th><th>Tầng</th><th>BP</th><th>HM</th><th>Người vẽ</th><th>KH nộp</th><th>Trạng thái</th></tr></thead><tbody>${rows}</tbody></table>` : "<p>Không có nhiệm vụ nào trong tuần.</p>"}
    </body></html>`;
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `ke_hoach_tuan_${weekNum}_${monIso}.html`; a.click();
    URL.revokeObjectURL(url);
  };

  const exportWeekCSV = () => {
    const headers = ["Loại", "Mã", "Tên", "Block", "Tầng", "BP", "Hạng mục", "Người vẽ", "KH nộp", "Trạng thái", "Nhóm"];
    const esc = v => { const s = String(v ?? ""); return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s; };
    const rowsA = overdueUnstarted.map(it => [it.type, it.code, it.name, it.block, it.floor, it.dept, it.cat, it.who, it.planDate, getStatusItem(it.type, it.status)?.l || it.status, "Chậm KH chưa triển khai"].map(esc).join(","));
    const rowsB = weekTasks.map(it => [it.type, it.code, it.name, it.block, it.floor, it.dept, it.cat, it.who, it.planDate, getStatusItem(it.type, it.status)?.l || it.status, "Thuộc tuần"].map(esc).join(","));
    const csv = [headers.join(","), ...rowsA, ...rowsB].join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `ke_hoach_tuan_${weekNum}_${monIso}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const totBlocks = {};
  weekTasks.forEach(it => { if (it.block) totBlocks[it.block] = (totBlocks[it.block] || 0) + 1; });

  return <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
    {/* Week Navigator */}
    <div style={{ background: "var(--surface)", borderRadius: 10, padding: "12px 16px", border: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <button onClick={() => setWeekMonday(shiftWeek(weekMonday, -1))} style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>◀ Tuần trước</button>
      <div style={{ flex: 1, textAlign: "center" }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text)" }}>Tuần {weekNum} — {getWeekRange(monIso)}</div>
        <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>
          {monIso <= td() && td() <= sunIso ? "📍 Tuần hiện tại" : monIso > td() ? "🔜 Tuần tương lai" : "⏮ Tuần đã qua"}
        </div>
      </div>
      <button onClick={() => setWeekMonday(shiftWeek(weekMonday, 1))} style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Tuần sau ▶</button>
      <button onClick={() => { const m = getMondayOf(td()); setWeekMonday(isoFromDate(m)); }} style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #B08D57", background: "transparent", color: "#B08D57", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>📅 Tuần này</button>
      <div style={{ width: 1, height: 24, background: "var(--border)" }} />
      <button onClick={exportWeekHTML} style={{ padding: "6px 12px", borderRadius: 6, border: "none", background: "linear-gradient(135deg,#1E3A5F,#2C5282)", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>📄 Xuất HTML</button>
      <button onClick={exportWeekCSV} style={{ padding: "6px 12px", borderRadius: 6, border: "none", background: "linear-gradient(135deg,#B08D57,#8B6B3D)", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>📊 Xuất CSV</button>
    </div>

    {/* Summary cards */}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
      {[
        { l: "CHẬM KH CHƯA TRIỂN KHAI", v: overdueUnstarted.length, c: "#DC2626", i: "⚠️" },
        { l: "TASK THUỘC TUẦN", v: weekTasks.length, c: "#1E3A5F", i: "📋" },
        { l: "SD TRONG TUẦN", v: weekTasks.filter(i => i.type === "SD").length, c: "#B08D57", i: "📐" },
        { l: "RFI TRONG TUẦN", v: weekTasks.filter(i => i.type === "RFI").length, c: "#0891B2", i: "📝" },
      ].map((c, i) => <div key={i} style={{ background: "var(--surface)", borderRadius: 10, padding: "14px 16px", border: "1px solid var(--border)", borderLeft: `3px solid ${c.c}` }}>
        <div style={{ fontSize: 18, marginBottom: 4 }}>{c.i}</div>
        <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 700, letterSpacing: 0.5 }}>{c.l}</div>
        <div style={{ fontSize: 28, fontWeight: 800, color: c.c, fontFamily: "'JetBrains Mono'", marginTop: 4 }}>{c.v}</div>
      </div>)}
    </div>

    {/* Section A: Chậm kế hoạch chưa triển khai */}
    <div style={{ background: "var(--surface)", borderRadius: 10, padding: 14, border: "1px solid var(--border)", borderLeft: "3px solid #DC2626" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#DC2626" }}>⚠️ Nhiệm vụ chậm kế hoạch (chưa triển khai) — {overdueUnstarted.length} mục</div>
        <div style={{ fontSize: 10, color: "var(--text-dim)" }}>KH đã trôi qua mà chưa có TT nộp</div>
      </div>
      {!overdueUnstarted.length ? <div style={{ padding: 20, textAlign: "center", color: "var(--text-dim)", fontSize: 12 }}>Không có mục nào chậm — tất cả đã triển khai đúng hạn ✓</div> :
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead><tr style={{ background: "var(--surface2)" }}>{["STT", "Loại", "Mã", "Tên", "Block", "Hạng mục", "Người vẽ", "KH nộp", "Chậm", "Trạng thái"].map((h, i) => <th key={i} style={{ padding: "8px 8px", textAlign: "left", fontWeight: 700, color: "var(--text-muted)", borderBottom: "1px solid var(--border)", fontSize: 10 }}>{h}</th>)}</tr></thead>
            <tbody>{overdueUnstarted.map((it, i) => {
              const st = getStatusItem(it.type, it.status); const delay = dd(todayIso, it.planDate);
              const dpt = DEPTS.find(d => d.k === it.dept);
              return <tr key={it.id} onClick={() => onDetail(it.id)} style={{ cursor: "pointer", borderBottom: "1px solid var(--border)", background: "rgba(220,38,38,0.04)" }}
                onMouseEnter={e => e.currentTarget.style.background = "rgba(220,38,38,0.1)"}
                onMouseLeave={e => e.currentTarget.style.background = "rgba(220,38,38,0.04)"}>
                <td style={{ padding: "7px 8px", fontWeight: 700 }}>{i + 1}</td>
                <td style={{ padding: "7px 8px" }}>{it.type === "SD" ? "📐" : "📝"} {it.type}</td>
                <td style={{ padding: "7px 8px", fontWeight: 700, fontFamily: "'JetBrains Mono'", color: "#1E3A5F" }}>{it.code}</td>
                <td style={{ padding: "7px 8px", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</td>
                <td style={{ padding: "7px 8px" }}>{it.block}</td>
                <td style={{ padding: "7px 8px" }}><Bd c={dpt?.c} bg={dpt?.bg}>{it.dept}</Bd> {it.cat}</td>
                <td style={{ padding: "7px 8px" }}>{it.who}</td>
                <td style={{ padding: "7px 8px", fontFamily: "'JetBrains Mono'", fontSize: 10 }}>{fmFull(it.planDate)}</td>
                <td style={{ padding: "7px 8px" }}><Bd c="#DC2626" bg="#FEE2E2">+{delay} ngày</Bd></td>
                <td style={{ padding: "7px 8px" }}><Bd c={st?.c} bg={st?.bg}>{st?.l || it.status}</Bd></td>
              </tr>;
            })}</tbody>
          </table>
        </div>}
    </div>

    {/* Section B: Task theo từng ngày trong tuần */}
    <div style={{ background: "var(--surface)", borderRadius: 10, padding: 14, border: "1px solid var(--border)", borderLeft: "3px solid #1E3A5F" }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 10 }}>📋 Phân bố nhiệm vụ theo ngày trong tuần</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8 }}>
        {Object.entries(byDay).map(([dayIso, tasks], i) => {
          const isToday = dayIso === todayIso;
          const isPast = dayIso < todayIso;
          const dayDate = new Date(dayIso);
          return <div key={dayIso} style={{
            background: isToday ? "rgba(176,141,87,0.15)" : "var(--surface2)",
            borderRadius: 8, padding: 10, minHeight: 120,
            border: isToday ? "2px solid #B08D57" : "1px solid var(--border)",
            opacity: isPast && !isToday ? 0.7 : 1
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8, paddingBottom: 6, borderBottom: "1px solid var(--border)" }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, color: isToday ? "#B08D57" : "var(--text)" }}>{dayNames[i]} {isToday && "•"}</div>
                <div style={{ fontSize: 9, color: "var(--text-dim)" }}>{dayDate.getDate()}/{dayDate.getMonth() + 1}</div>
              </div>
              <div style={{ fontSize: 16, fontWeight: 800, color: isToday ? "#B08D57" : "var(--text-muted)", fontFamily: "'JetBrains Mono'" }}>{tasks.length}</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 200, overflowY: "auto" }}>
              {tasks.slice(0, 6).map(it => {
                const st = getStatusItem(it.type, it.status);
                return <div key={it.id} onClick={() => onDetail(it.id)} style={{ padding: "5px 6px", background: "var(--surface)", borderRadius: 5, fontSize: 9, cursor: "pointer", borderLeft: `2px solid ${st?.c || "#6B7280"}` }}>
                  <div style={{ fontWeight: 700, fontFamily: "'JetBrains Mono'", fontSize: 9, color: "#1E3A5F" }}>{it.code}</div>
                  <div style={{ color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</div>
                </div>;
              })}
              {tasks.length > 6 && <div style={{ fontSize: 9, color: "var(--text-dim)", textAlign: "center" }}>+{tasks.length - 6} nữa</div>}
              {!tasks.length && <div style={{ fontSize: 10, color: "var(--text-dim)", textAlign: "center", padding: 8 }}>—</div>}
            </div>
          </div>;
        })}
      </div>
    </div>

    {/* Section C: Bảng đầy đủ task thuộc tuần */}
    <div style={{ background: "var(--surface)", borderRadius: 10, padding: 14, border: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>📅 Danh sách nhiệm vụ thuộc tuần — {weekTasks.length} mục</div>
      </div>
      {!weekTasks.length ? <div style={{ padding: 20, textAlign: "center", color: "var(--text-dim)", fontSize: 12 }}>Không có nhiệm vụ nào trong tuần này</div> :
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead><tr style={{ background: "var(--surface2)" }}>{["Loại", "Mã", "Tên", "Block", "Tầng", "BP", "Hạng mục", "Người vẽ", "KH nộp", "Trạng thái", "Rủi ro"].map((h, i) => <th key={i} style={{ padding: "8px 8px", textAlign: "left", fontWeight: 700, color: "var(--text-muted)", borderBottom: "1px solid var(--border)", fontSize: 10 }}>{h}</th>)}</tr></thead>
            <tbody>{weekTasks.map(it => {
              const st = getStatusItem(it.type, it.status); const r = rsk(it); const rc = RC[r];
              const dpt = DEPTS.find(d => d.k === it.dept);
              const isToday = it.planDate === todayIso;
              return <tr key={it.id} onClick={() => onDetail(it.id)} style={{ cursor: "pointer", borderBottom: "1px solid var(--border)", background: isToday ? "rgba(176,141,87,0.08)" : "transparent" }}
                onMouseEnter={e => e.currentTarget.style.background = "var(--hover)"}
                onMouseLeave={e => e.currentTarget.style.background = isToday ? "rgba(176,141,87,0.08)" : "transparent"}>
                <td style={{ padding: "7px 8px" }}>{it.type === "SD" ? "📐" : "📝"}</td>
                <td style={{ padding: "7px 8px", fontWeight: 700, fontFamily: "'JetBrains Mono'", color: "#1E3A5F" }}>{it.code}</td>
                <td style={{ padding: "7px 8px", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</td>
                <td style={{ padding: "7px 8px" }}>{it.block}</td>
                <td style={{ padding: "7px 8px" }}>{it.floor}</td>
                <td style={{ padding: "7px 8px" }}><Bd c={dpt?.c} bg={dpt?.bg}>{it.dept}</Bd></td>
                <td style={{ padding: "7px 8px" }}>{it.cat}</td>
                <td style={{ padding: "7px 8px" }}>{it.who}</td>
                <td style={{ padding: "7px 8px", fontFamily: "'JetBrains Mono'", fontSize: 10, fontWeight: isToday ? 700 : 400, color: isToday ? "#B08D57" : "var(--text)" }}>{fmFull(it.planDate)}{isToday && " ◀"}</td>
                <td style={{ padding: "7px 8px" }}><Bd c={st?.c} bg={st?.bg}>{st?.l || it.status}</Bd></td>
                <td style={{ padding: "7px 8px" }}><span style={{ fontSize: 11 }}>{rc.i}</span></td>
              </tr>;
            })}</tbody>
          </table>
        </div>}
    </div>

    {/* Bottom: Phân bố theo Block */}
    {weekTasks.length > 0 && <div style={{ background: "var(--surface)", borderRadius: 10, padding: 14, border: "1px solid var(--border)" }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", marginBottom: 10 }}>Phân bố theo Block</div>
      <Bar data={Object.entries(totBlocks).map(([l, v]) => ({ l, v, c: "#B08D57" }))} h={120} />
    </div>}
  </div>;
}

// ═══════════════════════════════════════════════════════════════
// ─── REPORT SUMMARY PAGE ───
// ═══════════════════════════════════════════════════════════════
function ReportSummaryPage({ items, stats, projectCfg }) {
  const today = td();
  const done = items.filter(i => isDone(i)).length;
  const pct = stats.tot ? Math.round(done / stats.tot * 100) : 0;
  const lateCount = items.filter(i => rsk(i) === "late").length;
  const highCount = items.filter(i => rsk(i) === "high").length;
  const sdItems = items.filter(i => i.type === "SD");
  const rfiItems = items.filter(i => i.type === "RFI");

  const previewReport = () => { const html = generateReportHTML(items, stats); const w = window.open("", "_blank"); w.document.write(html); w.document.close(); };
  const downloadReport = () => { const html = generateReportHTML(items, stats); const blob = new Blob([html], { type: "text/html;charset=utf-8" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `shopdrawing_studio_report_${td()}.html`; a.click(); URL.revokeObjectURL(url); };
  const previewSdReg = () => { const html = generateShopDrawingRegisterHTML(items, projectCfg); const w = window.open("", "_blank"); w.document.write(html); w.document.close(); };
  const downloadSdRegXls = () => { const html = generateShopDrawingRegisterHTML(items, projectCfg); const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `SD_Register_${projectCfg.projectCode}_${td()}.xls`; a.click(); URL.revokeObjectURL(url); };

  // A/B/C/D count cho SD
  const abcdCount = { A: 0, B: 0, C: 0, D: 0 };
  sdItems.forEach(it => { abcdCount[toABCD(it)]++; });

  return <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
    {/* Header */}
    <div style={{ background: "var(--surface)", borderRadius: 10, padding: "18px 20px", border: "1px solid var(--border)", borderLeft: "3px solid #B08D57" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text)", marginBottom: 4 }}>📑 BÁO CÁO TỔNG HỢP DỰ ÁN</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{projectCfg?.projectName || "Wealthcons"} · Cập nhật: {fmFull(today)} · Precision in Every Detail</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={previewReport} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #B08D57", background: "transparent", color: "#B08D57", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>👁️ Xem báo cáo</button>
          <button onClick={downloadReport} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#1E3A5F,#B08D57)", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>📄 Tải HTML</button>
        </div>
      </div>
    </div>

    {/* SD Register nhanh */}
    <div style={{ background: "var(--surface)", borderRadius: 10, padding: 16, border: "1px solid var(--border)", borderLeft: "3px solid #1E3A5F" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text)", marginBottom: 4 }}>📋 SHOP DRAWING REGISTER — Form chuẩn CĐT</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6 }}>
            Báo cáo theo đúng format đang dùng: group Zone → Discipline (STRUCTURE, FINISHING ARC...), khối STATUS A/B/C/D với % hoàn thành. Mã được tự ghép theo prefix ở Cài đặt dự án.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={previewSdReg} style={{ padding: "10px 16px", borderRadius: 8, border: "1px solid #1E3A5F", background: "transparent", color: "#1E3A5F", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>👁️ Xem</button>
          <button onClick={downloadSdRegXls} style={{ padding: "10px 16px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#1E3A5F,#B08D57)", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>📊 Tải Excel</button>
        </div>
      </div>
      {/* Tóm tắt A/B/C/D */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginTop: 14 }}>
        {Object.entries(ABCD_META).map(([k, meta]) => {
          const p = sdItems.length ? ((abcdCount[k] / sdItems.length) * 100).toFixed(1) : 0;
          return <div key={k} style={{ padding: "10px 12px", background: meta.bg, borderRadius: 6, borderLeft: `3px solid ${meta.c}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 22, height: 22, borderRadius: 4, background: meta.c, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 12 }}>{k}</span>
              <span style={{ fontSize: 10, color: meta.c, fontWeight: 600 }}>{meta.l}</span>
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: meta.c, fontFamily: "'JetBrains Mono'", marginTop: 4 }}>{abcdCount[k]}</div>
            <div style={{ fontSize: 10, color: meta.c, opacity: 0.8 }}>{p}%</div>
          </div>;
        })}
      </div>
    </div>

    {/* KPI Summary */}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
      {[
        { l: "TỔNG HẠNG MỤC", v: stats.tot, c: "#1E3A5F" },
        { l: "HOÀN THÀNH", v: `${done} (${pct}%)`, c: "#059669" },
        { l: "TRỄ HẠN", v: lateCount, c: "#DC2626" },
        { l: "NGUY CƠ CAO", v: highCount, c: "#EA580C" },
      ].map((c, i) => <div key={i} style={{ background: "var(--surface)", borderRadius: 10, padding: "14px 16px", border: "1px solid var(--border)", borderLeft: `3px solid ${c.c}` }}>
        <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 700, letterSpacing: 0.5 }}>{c.l}</div>
        <div style={{ fontSize: 26, fontWeight: 800, color: c.c, fontFamily: "'JetBrains Mono'", marginTop: 4 }}>{c.v}</div>
      </div>)}
    </div>

    {/* Split by type */}
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
      <div style={{ background: "var(--surface)", borderRadius: 10, padding: 16, border: "1px solid var(--border)" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 10, paddingBottom: 6, borderBottom: "2px solid #B08D57" }}>📐 SHOPDRAWING — {sdItems.length} mục</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {[
            ["Đã phê duyệt", sdItems.filter(i => isDone(i)).length, "#059669"],
            ["Đang xử lý", sdItems.filter(i => !isDone(i) && i.status !== "REJECT").length, "#D97706"],
            ["Trễ hạn", sdItems.filter(i => rsk(i) === "late").length, "#DC2626"],
            ["Reject", sdItems.filter(i => i.status === "REJECT").length, "#9CA3AF"],
          ].map(([l, v, c]) => <div key={l} style={{ padding: "8px 12px", background: "var(--surface2)", borderRadius: 6 }}>
            <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{l}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: c, fontFamily: "'JetBrains Mono'" }}>{v}</div>
          </div>)}
        </div>
      </div>
      <div style={{ background: "var(--surface)", borderRadius: 10, padding: 16, border: "1px solid var(--border)" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 10, paddingBottom: 6, borderBottom: "2px solid #B08D57" }}>📝 RFI — {rfiItems.length} mục</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {[
            ["Đã đóng", rfiItems.filter(i => normRfiStatus(i.status) === "CLOSED").length, "#059669"],
            ["Đang mở", rfiItems.filter(i => normRfiStatus(i.status) === "OPEN").length, "#D97706"],
            ["Quá hạn", rfiItems.filter(i => rsk(i) === "late").length, "#DC2626"],
            ["Chờ phân loại", rfiItems.filter(i => !i.rootCause).length, "#9CA3AF"],
          ].map(([l, v, c]) => <div key={l} style={{ padding: "8px 12px", background: "var(--surface2)", borderRadius: 6 }}>
            <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{l}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: c, fontFamily: "'JetBrains Mono'" }}>{v}</div>
          </div>)}
        </div>
      </div>
    </div>

    {/* Hướng dẫn */}
    <div style={{ background: "var(--surface2)", borderRadius: 10, padding: "14px 16px", fontSize: 11, color: "var(--text-muted)", lineHeight: 1.7 }}>
      <div style={{ fontWeight: 700, color: "var(--text)", marginBottom: 6, fontSize: 12 }}>💡 Hướng dẫn</div>
      <div>• Bấm <b>"👁️ Xem báo cáo"</b> để mở báo cáo HTML chi tiết trong tab mới — có thể in hoặc lưu PDF từ trình duyệt</div>
      <div>• Bấm <b>"📄 Tải HTML"</b> để tải file báo cáo về máy, gửi CĐT hoặc lưu trữ</div>
      <div>• Báo cáo bao gồm: KPI tổng, danh sách trễ hạn, nguy cơ cao, và toàn bộ hạng mục</div>
    </div>
  </div>;
}

// ═══════════════════════════════════════════════════════════════
// ─── REPORT EXPORT PAGE ───
// ═══════════════════════════════════════════════════════════════
function ReportExportPage({ onShowExport, onShowImport }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 800 }}>
    <div style={{ background: "var(--surface)", borderRadius: 10, padding: 18, border: "1px solid var(--border)", borderLeft: "3px solid #B08D57" }}>
      <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text)", marginBottom: 4 }}>📤 Xuất / Nhập dữ liệu</div>
      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Đồng bộ dữ liệu giữa hệ thống và Excel/Google Sheets</div>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      <div style={{ background: "var(--surface)", borderRadius: 10, padding: 18, border: "1px solid var(--border)" }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 10 }}>📤 Xuất dữ liệu</div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.7, marginBottom: 12 }}>
          • Xuất toàn bộ SD & RFI ra CSV (mở bằng Excel/Google Sheets)<br />
          • Xuất báo cáo HTML đã format đẹp để gửi CĐT<br />
          • Tách riêng SD / RFI nếu cần<br />
        </div>
        <button onClick={onShowExport} style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#1E3A5F,#2C5282)", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", width: "100%" }}>📤 Mở cửa sổ xuất</button>
      </div>

      <div style={{ background: "var(--surface)", borderRadius: 10, padding: 18, border: "1px solid var(--border)" }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 10 }}>📥 Nhập dữ liệu</div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.7, marginBottom: 12 }}>
          • Paste trực tiếp từ Excel (Ctrl+C → Ctrl+V)<br />
          • Hỗ trợ CSV/TSV với cột tiếng Việt<br />
          • Auto-mapping các cột phổ biến<br />
          • Bỏ qua dòng trùng mã<br />
        </div>
        {onShowImport ? <button onClick={onShowImport} style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#B08D57,#8B6B3D)", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", width: "100%" }}>📥 Mở cửa sổ nhập</button>
          : <div style={{ padding: "10px 14px", background: "var(--surface2)", borderRadius: 8, fontSize: 11, color: "var(--text-dim)", textAlign: "center" }}>Chỉ Biên tập / Chủ sở hữu mới có quyền nhập</div>}
      </div>
    </div>

    {/* Format guide */}
    <div style={{ background: "var(--surface)", borderRadius: 10, padding: 16, border: "1px solid var(--border)" }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 10 }}>📘 Định dạng file chuẩn</div>
      <div style={{ overflowX: "auto", background: "var(--surface2)", borderRadius: 6, padding: 10 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10, fontFamily: "'JetBrains Mono'" }}>
          <thead><tr>{["Loại", "Mã", "Tên", "Block", "Tầng", "BP", "Hạng mục", "Người vẽ", "Đệ trình", "Trạng thái", "KH nộp", "TT nộp", "TT duyệt", "Offset", "Rev"].map(h => <th key={h} style={{ padding: "5px 6px", textAlign: "left", color: "#B08D57", borderBottom: "1px solid var(--border)", fontSize: 9, whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
          <tbody>
            <tr><td style={{ padding: "4px 6px" }}>SD</td><td style={{ padding: "4px 6px" }}>SD-KC-001</td><td style={{ padding: "4px 6px" }}>MB cốp pha</td><td style={{ padding: "4px 6px" }}>Block A</td><td style={{ padding: "4px 6px" }}>T5</td><td style={{ padding: "4px 6px" }}>CIV</td><td style={{ padding: "4px 6px" }}>Kết cấu</td><td style={{ padding: "4px 6px" }}>Nguyễn A</td><td style={{ padding: "4px 6px" }}>Tân</td><td style={{ padding: "4px 6px" }}>Đã duyệt</td><td style={{ padding: "4px 6px" }}>01/04/2026</td><td style={{ padding: "4px 6px" }}>02/04/2026</td><td style={{ padding: "4px 6px" }}>09/04/2026</td><td style={{ padding: "4px 6px" }}>7</td><td style={{ padding: "4px 6px" }}>0</td></tr>
            <tr><td style={{ padding: "4px 6px" }}>RFI</td><td style={{ padding: "4px 6px" }}>RFI-001</td><td style={{ padding: "4px 6px" }}>Xác nhận cao độ</td><td style={{ padding: "4px 6px" }}>Block A</td><td style={{ padding: "4px 6px" }}>T5</td><td style={{ padding: "4px 6px" }}>CIV</td><td style={{ padding: "4px 6px" }}>Kết cấu</td><td style={{ padding: "4px 6px" }}>Nguyễn A</td><td style={{ padding: "4px 6px" }}>Tân</td><td style={{ padding: "4px 6px" }}>Đã đóng</td><td style={{ padding: "4px 6px" }}>—</td><td style={{ padding: "4px 6px" }}>01/04/2026</td><td style={{ padding: "4px 6px" }}>03/04/2026</td><td style={{ padding: "4px 6px" }}>3</td><td style={{ padding: "4px 6px" }}>0</td></tr>
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 8, lineHeight: 1.6 }}>
        • <b>Trạng thái SD:</b> Đang vẽ, Chờ review, Đã nộp, Chờ duyệt, Đã duyệt, Reject, Duyệt có GC, Tái nộp<br />
        • <b>Trạng thái RFI:</b> Đang mở / Đã đóng<br />
        • <b>Bộ phận:</b> CIV (xây dựng) hoặc MEP (cơ điện)<br />
        • <b>Định dạng ngày:</b> DD/MM/YYYY hoặc YYYY-MM-DD<br />
        • <b>Offset:</b> số ngày từ "TT nộp" đến "KH duyệt" (SD mặc định 7, RFI mặc định 3)
      </div>
    </div>
  </div>;
}

// ═══════════════════════════════════════════════════════════════
// ─── SETTINGS PROJECT PAGE ───
// ═══════════════════════════════════════════════════════════════
function SettingsProjectPage({ showToast }) {
  const [cfg, setCfg] = useState(DEFAULT_PROJECT_CFG);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const cfgRef = ref(db, PROJECT_CFG_REF);
    return onValue(cfgRef, (snap) => {
      const data = snap.val();
      if (data) setCfg({ ...DEFAULT_PROJECT_CFG, ...data });
    });
  }, []);

  const u = (k, v) => { setCfg(p => ({ ...p, [k]: v })); setDirty(true); };

  const handleSave = async () => {
    setSaving(true);
    try {
      await set(ref(db, PROJECT_CFG_REF), cfg);
      setDirty(false);
      showToast && showToast("Đã lưu cấu hình dự án");
    } catch (err) {
      showToast && showToast("Lỗi lưu: " + err.message, "error");
    }
    setSaving(false);
  };

  const handleReset = () => {
    if (!window.confirm("Khôi phục về cấu hình mặc định? Thay đổi chưa lưu sẽ mất.")) return;
    setCfg(DEFAULT_PROJECT_CFG);
    setDirty(true);
  };

  const I = { padding: "9px 12px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)", fontSize: 12, width: "100%" };
  const L = { fontSize: 10, fontWeight: 700, color: "var(--text-muted)", marginBottom: 4, letterSpacing: 0.3 };

  // Preview mã
  const previewCode = `${cfg.projectCode}-${cfg.contractorCode}-${cfg.packageCode}-${cfg.defaultZone}-${cfg.typeCode}-ARC-0001`;

  return <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 900 }}>
    <div style={{ background: "var(--surface)", borderRadius: 10, padding: 18, border: "1px solid var(--border)", borderLeft: "3px solid #B08D57", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
      <div>
        <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text)" }}>🏗️ Cài đặt dự án</div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>Các thông tin này dùng để ghép mã đầy đủ khi xuất SHOP DRAWING REGISTER</div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {dirty && <span style={{ padding: "6px 12px", borderRadius: 6, background: "#FEF3C7", color: "#92400E", fontSize: 11, fontWeight: 600 }}>● Có thay đổi chưa lưu</span>}
        <button onClick={handleReset} style={{ padding: "8px 14px", borderRadius: 7, border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>↺ Mặc định</button>
        <button onClick={handleSave} disabled={!dirty || saving} style={{ padding: "8px 18px", borderRadius: 7, border: "none", background: dirty ? "linear-gradient(135deg,#1E3A5F,#B08D57)" : "var(--surface2)", color: dirty ? "#fff" : "var(--text-dim)", fontSize: 12, fontWeight: 700, cursor: dirty ? "pointer" : "not-allowed", opacity: saving ? 0.7 : 1 }}>
          {saving ? "Đang lưu..." : "💾 Lưu thay đổi"}
        </button>
      </div>
    </div>

    {/* Form thông tin dự án */}
    <div style={{ background: "var(--surface)", borderRadius: 10, padding: 20, border: "1px solid var(--border)" }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 14, paddingBottom: 8, borderBottom: "2px solid #B08D57" }}>📋 Thông tin chung</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={{ gridColumn: "1/-1" }}>
          <div style={L}>TÊN DỰ ÁN ĐẦY ĐỦ</div>
          <input value={cfg.projectName} onChange={e => u("projectName", e.target.value)} style={I} placeholder="MANDARIN ORIENTAL BAI NOM" />
          <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 3 }}>Hiển thị ở dòng "Project:" trong báo cáo xuất</div>
        </div>
        <div>
          <div style={L}>SUBJECT / CHỦ ĐỀ BÁO CÁO</div>
          <input value={cfg.subject} onChange={e => u("subject", e.target.value)} style={I} placeholder="DOCUMENT CONTROL" />
        </div>
        <div>
          <div style={L}>ZONE MẶC ĐỊNH</div>
          <input value={cfg.defaultZone} onChange={e => u("defaultZone", e.target.value)} style={I} placeholder="MUV2" />
          <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 3 }}>Dùng khi SD không khai báo zone riêng</div>
        </div>
      </div>
    </div>

    {/* Prefix builder */}
    <div style={{ background: "var(--surface)", borderRadius: 10, padding: 20, border: "1px solid var(--border)" }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 6, paddingBottom: 8, borderBottom: "2px solid #B08D57" }}>🔤 Cấu trúc mã bản vẽ</div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 14, lineHeight: 1.6 }}>
        Khi xuất SD Register, mã ngắn của bạn (VD: SD-KC-001) sẽ được tự ghép thành mã đầy đủ theo cấu trúc:
        <br /><code style={{ background: "var(--surface2)", padding: "2px 6px", borderRadius: 3, fontSize: 10, color: "#B08D57" }}>[Project]-[Contractor]-[Package]-[Zone]-[Type]-[Discipline]-[STT]</code>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
        <div>
          <div style={L}>PROJECT CODE</div>
          <input value={cfg.projectCode} onChange={e => u("projectCode", e.target.value.toUpperCase())} style={I} placeholder="MOBN" maxLength={8} />
        </div>
        <div>
          <div style={L}>CONTRACTOR</div>
          <input value={cfg.contractorCode} onChange={e => u("contractorCode", e.target.value.toUpperCase())} style={I} placeholder="WCN" maxLength={6} />
        </div>
        <div>
          <div style={L}>PACKAGE CODE</div>
          <input value={cfg.packageCode} onChange={e => u("packageCode", e.target.value.toUpperCase())} style={I} placeholder="WP07" maxLength={6} />
        </div>
        <div>
          <div style={L}>TYPE CODE</div>
          <input value={cfg.typeCode} onChange={e => u("typeCode", e.target.value.toUpperCase())} style={I} placeholder="SDG" maxLength={6} />
        </div>
      </div>

      {/* Preview */}
      <div style={{ marginTop: 14, padding: "12px 16px", background: "linear-gradient(135deg,rgba(30,58,95,0.08),rgba(176,141,87,0.08))", borderRadius: 8, border: "1px dashed #B08D57" }}>
        <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 700, marginBottom: 6, letterSpacing: 0.5 }}>XEM TRƯỚC MÃ ĐẦY ĐỦ</div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 14, fontWeight: 800, color: "#1E3A5F", letterSpacing: 0.5 }}>{previewCode}</div>
        <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 6 }}>
          {cfg.projectCode && <span style={{ color: "#1E3A5F" }}>{cfg.projectCode}</span>}=Project ·{" "}
          {cfg.contractorCode && <span style={{ color: "#B08D57" }}>{cfg.contractorCode}</span>}=Nhà thầu ·{" "}
          {cfg.packageCode && <span style={{ color: "#059669" }}>{cfg.packageCode}</span>}=Gói thầu ·{" "}
          {cfg.defaultZone && <span style={{ color: "#7C3AED" }}>{cfg.defaultZone}</span>}=Zone ·{" "}
          {cfg.typeCode && <span style={{ color: "#DC2626" }}>{cfg.typeCode}</span>}=Loại hồ sơ · ARC=Bộ môn · 0001=STT
        </div>
      </div>
    </div>

    {/* Ánh xạ trạng thái A/B/C/D */}
    <div style={{ background: "var(--surface)", borderRadius: 10, padding: 20, border: "1px solid var(--border)" }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 10, paddingBottom: 8, borderBottom: "2px solid #B08D57" }}>🎯 Ánh xạ trạng thái → A/B/C/D (dùng khi xuất báo cáo)</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {Object.entries(ABCD_META).map(([k, meta]) => {
          const statuses = Object.entries(ABCD_MAP).filter(([, v]) => v === k).map(([s]) => getStatusItem("SD", s)?.l || s);
          return <div key={k} style={{ background: "var(--surface2)", borderRadius: 8, padding: 12, borderLeft: `3px solid ${meta.c}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ width: 28, height: 28, borderRadius: 4, background: meta.c, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 14 }}>{k}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>{meta.l}</span>
            </div>
            <div style={{ fontSize: 10, color: "var(--text-muted)", lineHeight: 1.6 }}>
              Gồm: {statuses.join(" · ")}
            </div>
          </div>;
        })}
      </div>
    </div>

    {/* Bộ phận & Discipline */}
    <div style={{ background: "var(--surface)", borderRadius: 10, padding: 20, border: "1px solid var(--border)" }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 10, paddingBottom: 8, borderBottom: "2px solid #B08D57" }}>🏢 Bộ phận & Bộ môn (Discipline)</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {DEPTS.map(d => {
          const disciplines = DISCIPLINES.filter(x => x.dept === d.k);
          return <div key={d.k} style={{ background: "var(--surface2)", borderRadius: 8, padding: 14, borderLeft: `3px solid ${d.c}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <Bd c={d.c} bg={d.bg}>{d.l}</Bd>
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>({disciplines.length} bộ môn)</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
              {disciplines.map(x => <span key={x.k} style={{ padding: "3px 8px", background: x.bg, color: x.c, borderRadius: 4, fontSize: 10, fontWeight: 700 }}>{x.k}</span>)}
            </div>
            <div style={{ fontSize: 10, color: "var(--text-dim)", lineHeight: 1.5 }}>
              Hạng mục: {DEPT_CATS[d.k].join(", ")}
            </div>
          </div>;
        })}
      </div>
      <div style={{ marginTop: 10, padding: "10px 14px", background: "var(--surface2)", borderRadius: 6, fontSize: 10, color: "var(--text-muted)" }}>
        💡 <b>Discipline</b> (ARC/STRUC/FIN/ELE...) dùng để group trong SD Register khi xuất. Hệ thống tự suy luận từ Hạng mục nếu SD chưa khai báo discipline rõ.
      </div>
    </div>

    {/* Thông tin hệ thống */}
    <div style={{ background: "var(--surface2)", borderRadius: 10, padding: 14, fontSize: 11, color: "var(--text-muted)", lineHeight: 1.7 }}>
      <div style={{ fontWeight: 700, color: "var(--text)", fontSize: 12, marginBottom: 6 }}>ℹ️ Thông tin hệ thống</div>
      <div>• <b>Đơn vị:</b> Wealthcons — Thiết kế và thi công xây dựng</div>
      <div>• <b>Quy mô:</b> ~200 nhân viên · 200 tỷ</div>
      <div>• <b>Backend:</b> Firebase Realtime Database (asia-southeast1)</div>
      <div>• <b>Triển khai:</b> GitHub Pages (<code>npm run deploy</code>)</div>
      <div>• <b>Offset mặc định:</b> SD = 7 ngày · RFI = 3 ngày (chỉnh riêng trong từng record)</div>
    </div>
  </div>;
}

// ═══════════════════════════════════════════════════════════════
// ─── SETTINGS ROLES PAGE ───
// ═══════════════════════════════════════════════════════════════
function SettingsRolesPage() {
  const permissions = [
    { l: "Xem Dashboard & danh sách", viewer: true, editor: true, owner: true },
    { l: "Xem chi tiết, ghi chú, file đính kèm", viewer: true, editor: true, owner: true },
    { l: "Xuất dữ liệu (CSV/HTML)", viewer: true, editor: true, owner: true },
    { l: "Xuất kế hoạch tuần", viewer: true, editor: true, owner: true },
    { l: "Thêm mới SD / RFI", viewer: false, editor: true, owner: true },
    { l: "Sửa SD / RFI", viewer: false, editor: true, owner: true },
    { l: "Thêm ghi chú, đính kèm file", viewer: false, editor: true, owner: true },
    { l: "Nhập dữ liệu từ Excel/CSV", viewer: false, editor: true, owner: true },
    { l: "Đổi trạng thái nhanh (inline)", viewer: false, editor: true, owner: true },
    { l: "Xóa SD / RFI", viewer: false, editor: false, owner: true },
    { l: "Xóa nhiều mục (bulk)", viewer: false, editor: false, owner: true },
    { l: "Quản lý người dùng", viewer: false, editor: false, owner: true },
    { l: "Đổi vai trò người dùng", viewer: false, editor: false, owner: true },
  ];

  return <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 1000 }}>
    <div style={{ background: "var(--surface)", borderRadius: 10, padding: 18, border: "1px solid var(--border)", borderLeft: "3px solid #B08D57" }}>
      <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text)" }}>🔐 Vai trò & Phân quyền</div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>Hệ thống sử dụng 3 cấp độ quyền truy cập</div>
    </div>

    {/* Role cards */}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
      {Object.entries(ROLES).reverse().map(([k, r]) => <div key={k} style={{ background: "var(--surface)", borderRadius: 10, padding: 16, border: "1px solid var(--border)", borderTop: `3px solid ${r.c}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <div style={{ width: 36, height: 36, borderRadius: "50%", background: r.bg, color: r.c, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>
            {k === "owner" ? "👑" : k === "editor" ? "✏️" : "👁️"}
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text)" }}>{r.l}</div>
            <div style={{ fontSize: 10, color: "var(--text-dim)" }}>Level {r.level}</div>
          </div>
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6 }}>
          {k === "owner" && "Toàn quyền: thêm, sửa, xóa, quản lý user, phân quyền. Chỉ admin có vai trò này."}
          {k === "editor" && "Biên tập: thêm, sửa SD/RFI, nhập dữ liệu, thêm ghi chú. Không xóa được."}
          {k === "viewer" && "Chỉ xem: dashboard, danh sách, xuất báo cáo. Không thay đổi dữ liệu."}
        </div>
      </div>)}
    </div>

    {/* Permission matrix */}
    <div style={{ background: "var(--surface)", borderRadius: 10, padding: 16, border: "1px solid var(--border)" }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 10 }}>📋 Ma trận phân quyền chi tiết</div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead><tr style={{ background: "var(--surface2)" }}>
            <th style={{ padding: "10px 14px", textAlign: "left", color: "var(--text-muted)", fontSize: 11, fontWeight: 700, borderBottom: "1px solid var(--border)" }}>Chức năng</th>
            <th style={{ padding: "10px 14px", textAlign: "center", color: ROLES.viewer.c, fontSize: 11, fontWeight: 700, borderBottom: "1px solid var(--border)" }}>👁️ Viewer</th>
            <th style={{ padding: "10px 14px", textAlign: "center", color: ROLES.editor.c, fontSize: 11, fontWeight: 700, borderBottom: "1px solid var(--border)" }}>✏️ Editor</th>
            <th style={{ padding: "10px 14px", textAlign: "center", color: ROLES.owner.c, fontSize: 11, fontWeight: 700, borderBottom: "1px solid var(--border)" }}>👑 Owner</th>
          </tr></thead>
          <tbody>
            {permissions.map((p, i) => <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
              <td style={{ padding: "8px 14px", color: "var(--text)" }}>{p.l}</td>
              <td style={{ padding: "8px 14px", textAlign: "center" }}>{p.viewer ? <span style={{ color: "#059669", fontSize: 14 }}>✓</span> : <span style={{ color: "#9CA3AF" }}>—</span>}</td>
              <td style={{ padding: "8px 14px", textAlign: "center" }}>{p.editor ? <span style={{ color: "#059669", fontSize: 14 }}>✓</span> : <span style={{ color: "#9CA3AF" }}>—</span>}</td>
              <td style={{ padding: "8px 14px", textAlign: "center" }}>{p.owner ? <span style={{ color: "#059669", fontSize: 14 }}>✓</span> : <span style={{ color: "#9CA3AF" }}>—</span>}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </div>

    <div style={{ background: "var(--surface2)", borderRadius: 10, padding: "12px 16px", fontSize: 11, color: "var(--text-muted)", lineHeight: 1.7 }}>
      <div style={{ fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>💡 Ghi chú</div>
      • Tài khoản mới đăng ký mặc định có quyền <b>Viewer</b><br />
      • Chỉ <b>Owner</b> mới thay đổi được vai trò của user khác<br />
      • Tài khoản <b>admin</b> không thể bị xóa hoặc đổi vai trò<br />
      • Mật khẩu được lưu dạng plain text trên Firebase — cân nhắc chuyển sang Firebase Auth nếu cần bảo mật cao hơn
    </div>
  </div>;
}

// ═══════════════════════════════════════════════════════════════
// ─── DETAIL PANEL ───
// ═══════════════════════════════════════════════════════════════
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

  return <>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14, paddingBottom: 10, borderBottom: "2px solid #B08D57" }}>
      <div>
        <div style={{ fontSize: 10, color: "var(--text-dim)", fontWeight: 700, letterSpacing: 0.5 }}>{item.type === "SD" ? "📐 SHOPDRAWING" : "📝 RFI"}</div>
        <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "'JetBrains Mono'", color: "#1E3A5F" }}>{item.code || "—"}</div>
      </div>
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <span>{rc.i}</span><Bd c={rc.c} bg={rc.bg}>{rc.l}</Bd>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-dim)", fontSize: 20, cursor: "pointer", marginLeft: 8 }}>✕</button>
      </div>
    </div>
    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: "var(--text)" }}>{item.name || "Chưa đặt tên"}</div>
    {/* Info grid */}
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 14 }}>
      {[["Block", item.block], ["Tầng", item.floor], ["Bộ phận", item.dept ? <Bd c={dpt?.c} bg={dpt?.bg}>{item.dept}</Bd> : "—"], ["Hạng mục", item.cat], ["Người vẽ", item.who], ["Đệ trình", item.sub], ["Trạng thái", st ? <Bd c={st.c} bg={st.bg}>{st.l}</Bd> : item.status], ["Rev", item.rev],
        ...(item.type === "SD" ? [["KH nộp", fmFull(item.planDate)]] : []),
        ["TT nộp", fmFull(item.actualDate)],
        ...(item.type === "SD" ? [["Trễ trình", sd > 0 ? <Bd c="#EA580C" bg="#FFEDD5">+{sd}</Bd> : sd === 0 ? "0" : "—"]] : []),
        ["Offset", `+${item.offset} ngày`],
        [item.type === "RFI" ? "KH đóng" : "KH duyệt", fmFull(ap)],
        [item.type === "RFI" ? "TT đóng" : "TT duyệt", fmFull(item.approveDate)],
        ["Delay", l > 0 ? <Bd c="#DC2626" bg="#FEE2E2">+{l} ngày</Bd> : l === 0 ? "0" : "—"],
        ...(item.type === "RFI" ? [
          ["Nguyên nhân", rcItem ? <Bd c={rcItem.c} bg={rcItem.bg}>{rcItem.l}</Bd> : "—"],
          ["Người chịu TN", item.actionOwner || "—"],
          ["Trạng thái xử lý", actSt ? <Bd c={actSt.c} bg={actSt.bg}>{actSt.l}</Bd> : "—"],
          ["Deadline", fmFull(item.actionDeadline)],
        ] : []),
      ].map(([lbl, val], i) => <div key={i} style={{ padding: "6px 8px", background: "var(--surface2)", borderRadius: 6 }}>
        <div style={{ fontSize: 9, color: "var(--text-dim)", marginBottom: 2, fontWeight: 700 }}>{lbl}</div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{val || "—"}</div>
      </div>)}
    </div>

    {/* Links */}
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", marginBottom: 6 }}>🔗 Liên kết ({lk.length})</div>
      {lk.map(x => <div key={x.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", background: "var(--surface2)", borderRadius: 5, marginBottom: 3, cursor: "pointer" }} onClick={() => onGo(x.id)}>
        <span style={{ fontSize: 10 }}>{x.type === "SD" ? "📐" : "📝"}</span>
        <span style={{ fontSize: 11, fontWeight: 600, fontFamily: "'JetBrains Mono'", color: "#1E3A5F" }}>{x.code}</span>
        <span style={{ fontSize: 10, color: "var(--text-muted)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.name}</span>
        {canEd && <button onClick={e => { e.stopPropagation(); onUnlink(x.id); }} style={{ background: "none", border: "none", color: "var(--text-dim)", fontSize: 10, cursor: "pointer" }}>✕</button>}
      </div>)}
      {canEd && <>
        {slp ? <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
          <select value={ls} onChange={e => setLs(e.target.value)} style={{ flex: 1, padding: "4px 6px", borderRadius: 5, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)", fontSize: 11 }}>
            <option value="">Chọn...</option>{items.filter(x => x.id !== item.id && !(item.links || []).includes(x.id)).map(x => <option key={x.id} value={x.id}>{x.type} {x.code}: {x.name?.slice(0, 30)}</option>)}
          </select>
          <button onClick={() => { if (ls) { onLink(ls); setLs(""); } }} style={{ padding: "4px 8px", borderRadius: 5, border: "none", background: "#1E3A5F", color: "#fff", fontSize: 10, cursor: "pointer" }}>+</button>
          <button onClick={() => setSlp(false)} style={{ padding: "4px 8px", borderRadius: 5, border: "1px solid var(--border)", background: "transparent", color: "var(--text-dim)", fontSize: 10, cursor: "pointer" }}>✕</button>
        </div> : <button onClick={() => setSlp(true)} style={{ marginTop: 4, padding: "4px 10px", borderRadius: 5, border: "1px solid var(--border)", background: "transparent", color: "#B08D57", fontSize: 10, cursor: "pointer" }}>+ Thêm liên kết</button>}
      </>}
    </div>

    {/* Notes */}
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", marginBottom: 6 }}>📝 Ghi chú ({(item.notes || []).length})</div>
      {canEd && <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
        <input value={nt} onChange={e => setNt(e.target.value)} placeholder="Thêm ghi chú..." onKeyDown={e => { if (e.key === "Enter" && nt.trim()) { onNote(nt); setNt(""); } }} style={{ flex: 1, padding: "6px 8px", borderRadius: 5, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)", fontSize: 11 }} />
        <button onClick={() => fileRef.current?.click()} disabled={uploading} style={{ padding: "6px 8px", borderRadius: 5, border: "1px solid var(--border)", background: "transparent", color: "var(--text-dim)", fontSize: 11, cursor: "pointer" }}>{uploading ? "..." : "📎"}</button>
        <input ref={fileRef} type="file" onChange={handleFileUpload} style={{ display: "none" }} />
        <button onClick={() => { if (nt.trim()) { onNote(nt); setNt(""); } }} style={{ padding: "6px 10px", borderRadius: 5, border: "none", background: "#B08D57", color: "#fff", fontSize: 11, cursor: "pointer" }}>+</button>
      </div>}
      {(item.notes || []).slice().reverse().map(n => <div key={n.id} style={{ padding: "6px 8px", background: "var(--surface2)", borderRadius: 5, marginBottom: 3 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
          <span style={{ fontSize: 9, color: "var(--text-dim)" }}>{n.d} {n.h}</span>
          {canEd && <button onClick={() => onDelNote(n.id)} style={{ background: "none", border: "none", color: "var(--text-dim)", fontSize: 10, cursor: "pointer" }}>✕</button>}
        </div>
        <div style={{ fontSize: 11, lineHeight: 1.4, color: "var(--text)" }}>{n.t}</div>
        {n.file && <a href={n.file.url} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 3, fontSize: 10, color: "#B08D57", textDecoration: "none" }}>
          <span>{fileIcon(n.file.name)}</span>
          <span style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.file.name}</span>
          <span style={{ color: "var(--text-dim)" }}>({Math.round((n.file.size || 0) / 1024)}KB)</span>
        </a>}
      </div>)}
    </div>

    <div style={{ display: "flex", gap: 6 }}>
      {canEd && <button onClick={onEdit} style={{ flex: 1, padding: "8px 0", borderRadius: 7, border: "1px solid #1E3A5F", background: "transparent", color: "#1E3A5F", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>✏️ Sửa</button>}
      {canDel && <button onClick={() => { if (window.confirm("Xóa mục này?")) onDel(); }} style={{ padding: "8px 14px", borderRadius: 7, border: "1px solid #DC2626", background: "transparent", color: "#DC2626", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>🗑 Xóa</button>}
    </div>
  </>;
}

// ═══════════════════════════════════════════════════════════════
// ─── FORM ───
// ═══════════════════════════════════════════════════════════════
function FormV({ item, onSave, onCancel, canEd }) {
  const [f, setF] = useState({ ...item }); const u = (k, v) => setF(p => ({ ...p, [k]: v }));
  const isRFI = f.type === "RFI";
  const stList = getStatusList(f.type);
  const apprPlanDate = apprPlan(f);
  const r = rsk(f), rc = RC[r], l = ld(f);
  const sd = subDelay(f);
  const catOptions = DEPT_CATS[f.dept] || [];
  const I = { padding: "8px 10px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)", fontSize: 12, width: "100%" };
  const L = { fontSize: 10, fontWeight: 700, color: "var(--text-muted)", marginBottom: 2 };

  const onChangeType = (newType) => {
    setF(p => {
      const next = { ...p, type: newType };
      const validKeys = getStatusList(newType).map(s => s.k);
      if (!validKeys.includes(next.status)) next.status = newType === "RFI" ? "OPEN" : "DANG_VE";
      return next;
    });
  };

  if (!canEd) return <div style={{ background: "var(--surface)", borderRadius: 10, padding: 40, textAlign: "center", color: "var(--text-dim)" }}>Bạn không có quyền chỉnh sửa</div>;

  return <div style={{ background: "var(--surface)", borderRadius: 12, padding: 22, border: "1px solid var(--border)" }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, paddingBottom: 10, borderBottom: "2px solid #B08D57" }}>
      <h2 style={{ fontSize: 17, fontWeight: 800, color: "var(--text)" }}>{item.code ? "✏️ Sửa" : "➕ Thêm"} {f.type}</h2>
      <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
        <span>{rc.i}</span><Bd c={rc.c} bg={rc.bg}>{rc.l}</Bd>
        {sd > 0 && <Bd c="#EA580C" bg="#FFEDD5">Trễ trình {sd}d</Bd>}
        {l > 0 && <Bd c="#DC2626" bg="#FEE2E2">Delay {l}d</Bd>}
      </div>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
      <div><div style={L}>Loại</div><select value={f.type} onChange={e => onChangeType(e.target.value)} style={I}><option>SD</option><option>RFI</option></select></div>
      <div><div style={L}>Mã</div><input value={f.code} onChange={e => u("code", e.target.value)} style={I} placeholder={isRFI ? "RFI-001" : "SD-KC-001"} /></div>
      <div style={{ gridColumn: "1/-1" }}><div style={L}>Tên</div><input value={f.name} onChange={e => u("name", e.target.value)} style={I} placeholder="MB cốp pha sàn T5 — Block A" /></div>
      <div><div style={L}>Block</div><input value={f.block} onChange={e => u("block", e.target.value)} style={I} /></div>
      <div><div style={L}>Tầng</div><input value={f.floor} onChange={e => u("floor", e.target.value)} style={I} /></div>
      <div><div style={L}>Bộ phận</div>
        <div style={{ display: "flex", gap: 4 }}>
          {DEPTS.map(d => <button key={d.k} onClick={() => { u("dept", d.k); if (!DEPT_CATS[d.k].includes(f.cat)) u("cat", DEPT_CATS[d.k][0] || ""); }} style={{ flex: 1, padding: "8px 0", borderRadius: 7, border: "2px solid", fontSize: 12, fontWeight: 700, cursor: "pointer", borderColor: f.dept === d.k ? d.c : "var(--border)", background: f.dept === d.k ? d.bg : "transparent", color: f.dept === d.k ? d.c : "var(--text-muted)" }}>{d.l}</button>)}
        </div>
      </div>
      <div><div style={L}>Hạng mục</div><select value={f.cat} onChange={e => u("cat", e.target.value)} style={I}>{catOptions.map(c => <option key={c}>{c}</option>)}<option value="">— Khác —</option></select>{!catOptions.includes(f.cat) && f.cat !== "" && <input value={f.cat} onChange={e => u("cat", e.target.value)} style={{ ...I, marginTop: 4 }} placeholder="Nhập hạng mục..." />}</div>
      <div><div style={L}>Rev</div><input type="number" min={0} value={f.rev} onChange={e => u("rev", +e.target.value || 0)} style={I} /></div>
      <div><div style={L}>Người vẽ</div><input value={f.who} onChange={e => u("who", e.target.value)} style={I} /></div>
      <div><div style={L}>Đệ trình</div><input value={f.sub} onChange={e => u("sub", e.target.value)} style={I} /></div>
      <div><div style={L}>Trạng thái</div><select value={f.status} onChange={e => u("status", e.target.value)} style={I}>{stList.map(s => <option key={s.k} value={s.k}>{s.l}</option>)}</select></div>
      {!isRFI && <div><div style={L}>KH nộp</div><input type="date" value={f.planDate || ""} onChange={e => u("planDate", e.target.value)} style={I} /></div>}
      <div><div style={L}>TT nộp</div><input type="date" value={f.actualDate || ""} onChange={e => u("actualDate", e.target.value)} style={I} /></div>
      <div><div style={L}>Offset {isRFI ? "đóng" : "duyệt"}</div>
        <div style={{ display: "flex", gap: 3 }}>
          {[3, 5, 7, 10, 14].map(n => <button key={n} onClick={() => u("offset", n)} style={{ flex: 1, padding: "7px 0", borderRadius: 5, border: "1px solid", fontSize: 11, fontWeight: 700, cursor: "pointer", borderColor: f.offset === n ? "#1E3A5F" : "var(--border)", background: f.offset === n ? "#1E3A5F" : "transparent", color: f.offset === n ? "#fff" : "var(--text-muted)" }}>+{n}</button>)}
        </div>
      </div>
      <div><div style={L}>{isRFI ? "KH đóng" : "KH duyệt"} <span style={{ color: "var(--text-dim)", fontWeight: 400 }}>(tự tính)</span></div><div style={{ ...I, background: "var(--surface)", fontFamily: "'JetBrains Mono'" }}>{apprPlanDate ? fmFull(apprPlanDate) : "—"}</div></div>
      <div><div style={L}>{isRFI ? "TT đóng" : "TT duyệt"}</div><input type="date" value={f.approveDate || ""} onChange={e => u("approveDate", e.target.value)} style={I} /></div>
      {isRFI && <>
        <div><div style={L}>Nguyên nhân gốc</div><select value={f.rootCause || ""} onChange={e => u("rootCause", e.target.value)} style={I}><option value="">— Chọn —</option>{ROOT_CAUSES.map(rc => <option key={rc.k} value={rc.k}>{rc.l}</option>)}</select></div>
        <div><div style={L}>Người chịu trách nhiệm</div><input value={f.actionOwner || ""} onChange={e => u("actionOwner", e.target.value)} style={I} placeholder="TVTK / CĐT / Nhà thầu" /></div>
        <div><div style={L}>Trạng thái xử lý</div><select value={f.actionStatus || ""} onChange={e => u("actionStatus", e.target.value)} style={I}><option value="">— Chọn —</option>{ACTION_STATUS.map(s => <option key={s.k} value={s.k}>{s.l}</option>)}</select></div>
        <div><div style={L}>Deadline hành động</div><input type="date" value={f.actionDeadline || ""} onChange={e => u("actionDeadline", e.target.value)} style={I} /></div>
      </>}
    </div>
    <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
      <button onClick={onCancel} style={{ padding: "9px 20px", borderRadius: 7, border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Hủy</button>
      <button onClick={() => onSave(f)} style={{ padding: "9px 22px", borderRadius: 7, border: "none", background: "linear-gradient(135deg,#1E3A5F,#B08D57)", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>💾 Lưu</button>
    </div>
  </div>;
}
