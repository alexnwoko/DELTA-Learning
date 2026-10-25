## Decisions

1. The CSV `redistribution_rule` is the value's resolved rule, as in
   contract v0.3. A source created from a CSV takes that rule; `per_resource`
   and `excluded` are set by an administrator, never by a CSV.
2. `quality_flags` is one CSV cell, flags separated by semicolons, sent to
   PostgreSQL as one string and split there, because the SQL template expands a
   JS array into a value list.
3. Exchange-rate rows keep `is_monetary` false: a rate is not a money amount.
