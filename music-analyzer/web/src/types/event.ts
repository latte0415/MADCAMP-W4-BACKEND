/** 역할별 대역 목록 (P0/P1/P2 각각 band 이름 배열) */
export interface EventRoles {
  P0: string[];
  P1: string[];
  P2: string[];
}

/**
 * 분석 이벤트 — 시각화용 JSON 형식
 * t: 시간(초), strength: 점 크기(0~1), texture: 세로 위치(height, 0~1), color: hex, layer: 레이어명
 * roles: 09 레이어 JSON용 — 역할별 대역 목록
 */
export interface EventPoint {
  t: number;
  strength: number;
  texture?: number;
  color: string;
  layer: string;
  roles?: EventRoles;
}
