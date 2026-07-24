(function initializeCandidateRules(global) {
  const HONORIFICS = new Set(['dr', 'mr', 'mrs', 'ms', 'prof']);
  const SUFFIXES = new Set([
    'jr', 'sr', 'ii', 'iii', 'iv', 'phd', 'md', 'mba', 'esq',
  ]);
  const ASIAN_SURNAMES = new Set([
    'ahn', 'alam', 'ali', 'amin', 'an', 'ang', 'bai', 'banerjee', 'bao',
    'basu', 'bhat', 'bhatt', 'biswas', 'bose', 'bui', 'cai', 'cao', 'chan',
    'chandra', 'chang', 'chatterjee', 'che', 'chen', 'cheng', 'cheung',
    'chiang', 'cho', 'chong', 'chow', 'chu', 'chung', 'dai', 'dang', 'dao',
    'das', 'deng', 'desai', 'dewan', 'dinh', 'do', 'dong', 'du', 'duong',
    'fan', 'fang', 'feng', 'fu', 'gao', 'ghosh', 'go', 'goh', 'gong',
    'gu', 'guo', 'gupta', 'ha', 'han', 'he', 'ho', 'hong', 'hou', 'hsieh',
    'hsu', 'hu', 'huang', 'hwang', 'ito', 'iyer', 'jang', 'jha', 'jiang',
    'jin', 'jo', 'joshi', 'kamat', 'kao', 'kapoor', 'kato', 'khan', 'khanna',
    'kim', 'kishore', 'koh', 'kong', 'kumar', 'kwak', 'kwan', 'kwok', 'lam',
    'lau', 'le', 'lee', 'li', 'lian', 'liang', 'liao', 'lim', 'lin', 'liu',
    'lo', 'lu', 'luo', 'ma', 'mah', 'malhotra', 'mao', 'matsumoto',
    'mehta', 'menon', 'min', 'mishra', 'mohanty', 'moon', 'mukherjee',
    'na', 'nakamura', 'ng', 'ngo', 'nguyen', 'nishimura', 'oh', 'okada',
    'ono', 'oyang', 'pan', 'pandey', 'park', 'patel', 'pham', 'phung',
    'qian', 'qin', 'rao', 'reddy', 'ren', 'saha', 'saito', 'sakurai',
    'sato', 'sen', 'seo', 'shah', 'sharma', 'shen', 'shi', 'shibata',
    'shimizu', 'singh', 'song', 'son', 'su', 'sun', 'suzuki', 'takahashi',
    'tan', 'tang', 'tao', 'thakur', 'thi', 'tian', 'to', 'tong', 'tran',
    'trinh', 'tsai', 'wang', 'watanabe', 'wei', 'wen', 'wong', 'woo', 'wu',
    'xiang', 'xiao', 'xie', 'xu', 'xue', 'yamamoto', 'yamashita', 'yan',
    'yang', 'yao', 'ye', 'yeh', 'yi', 'yin', 'yoon', 'you', 'young', 'yu',
    'yuan', 'zeng', 'zhang', 'zhao', 'zheng', 'zhong', 'zhou', 'zhu',
  ]);

  const EXCLUDED_TITLE_PATTERNS = [
    /\bco[\s-]?founder\b/,
    /\bfounder\b/,
    /\bowner\b/,
    /\bchief\b/,
    /\b(?:ceo|cfo|coo|cto|cio|cmo|cro|cpo)\b/,
    /\bpresident\b/,
    /\bvice[\s-]+president\b/,
    /\bvp\b/,
    /\bdirector\b/,
    /\bhead[\s-]+of\b/,
    /\bpartner\b/,
    /\bprincipal\b/,
    /\bmanager\b/,
  ];
  const POSITIVE_TITLE_PATTERNS = [
    /\bengineer(?:ing)?\b/,
    /\bdata\b/,
    /\banalytics?\b/,
    /\banalyst\b/,
    /\bdata[\s-]+scien(?:ce|tist)\b/,
    /\bmachine[\s-]+learning\b/,
    /\bml\b/,
    /\bartificial[\s-]+intelligence\b/,
    /\bai\b/,
    /\bbusiness[\s-]+intelligence\b/,
    /\bbi\b/,
    /\bdatabase\b/,
    /\bdba\b/,
  ];

  function normalize(value) {
    return String(value || '')
      .normalize('NFKD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[’']/g, '')
      .replace(/\./g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function extractSurname(fullName) {
    const normalized = normalize(fullName);
    if (!normalized) return '';

    const commaParts = normalized.split(',').map((part) => part.trim());
    if (commaParts.length > 1) {
      const possibleSurname = commaParts[0]
        .split(/\s+/)
        .filter((token) => !HONORIFICS.has(token));
      return possibleSurname[possibleSurname.length - 1] || '';
    }

    const tokens = normalized
      .split(/\s+/)
      .filter((token, index) => !(index === 0 && HONORIFICS.has(token)));
    while (tokens.length > 1 && SUFFIXES.has(tokens[tokens.length - 1])) {
      tokens.pop();
    }
    return tokens[tokens.length - 1] || '';
  }

  function hasAsianSurname(fullName) {
    const surname = extractSurname(fullName);
    if (!surname) return false;
    return ASIAN_SURNAMES.has(surname) ||
      surname.split('-').some((part) => ASIAN_SURNAMES.has(part));
  }

  function matchesAny(value, patterns) {
    const normalized = normalize(value).replace(/[/_]/g, ' ');
    return patterns.some((pattern) => pattern.test(normalized));
  }

  function isExcludedTitle(title) {
    return matchesAny(title, EXCLUDED_TITLE_PATTERNS);
  }

  function hasTargetTitle(title) {
    return matchesAny(title, POSITIVE_TITLE_PATTERNS);
  }

  function classifyCandidate(candidate) {
    if (isExcludedTitle(candidate && candidate.title)) return 'excluded';
    if (hasAsianSurname(candidate && candidate.name)) return 'surname';
    if (hasTargetTitle(candidate && candidate.title)) return 'title';
    return 'ineligible';
  }

  function rankCandidates(candidates, selectedUrls = new Set()) {
    const seen = new Set(selectedUrls);
    const surnameMatches = [];
    const titleMatches = [];

    for (const candidate of candidates || []) {
      if (!candidate || !candidate.url || !candidate.name || seen.has(candidate.url)) {
        continue;
      }
      seen.add(candidate.url);
      const classification = classifyCandidate(candidate);
      if (classification === 'surname') surnameMatches.push(candidate);
      if (classification === 'title') titleMatches.push(candidate);
    }
    return surnameMatches.concat(titleMatches);
  }

  global.CandidateRules = Object.freeze({
    classifyCandidate,
    extractSurname,
    hasAsianSurname,
    hasTargetTitle,
    isExcludedTitle,
    rankCandidates,
  });
})(globalThis);
